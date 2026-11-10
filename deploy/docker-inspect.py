#!/usr/bin/env python3
"""Internal, bounded container inspection for the lifecycle's owned child.

Only the proven default local Docker endpoint uses the Engine API. Any custom
CLI, context, TLS/header configuration or unproven environment retains the exact
original CLI before a request is made. After selecting the API, failures never
retry through another transport. The parent owns the shared 15-second deadline,
process-group cancellation and 128-KiB output limit for the entire batch.
"""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import socket
import stat
import sys


DEFAULT_SOCKET = '/var/run/docker.sock'
CONFIG_LIMIT = 1024 * 1024
RAW_INSPECT_LIMIT = 4 * 1024 * 1024
VERSION_LIMIT = 64 * 1024
OUTPUT_LIMIT = 128 * 1024
API_MIN, API_MAX = (1, 40), (1, 56)
SELECTORS = ('DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST',
             'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH',
             'DOCKER_CUSTOM_HEADERS', 'DOCKER_API_VERSION')
INSPECT_FORMAT = ('{"id":{{json .Id}},'
                  '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                  '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                  '"running":{{json .State.Running}},"paused":{{json .State.Paused}},'
                  '"status":{{json .State.Status}},'
                  '"health":{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}}}')


class InspectionError(Exception):
    pass


def api_version(value):
    if not isinstance(value, str) or not re.fullmatch(r'1\.[0-9]{1,3}', value):
        raise InspectionError()
    return tuple(int(part) for part in value.split('.'))


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise InspectionError()
        value[key] = item
    return value


def json_document(raw):
    def invalid_constant(_value):
        raise InspectionError()
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object,
                      parse_constant=invalid_constant)


def standard_docker(inherited, protected):
    """Do not bypass a PATH wrapper, including one selected by protected ENV."""
    if sys.platform != 'linux':
        return False
    for env in (inherited, protected):
        if shutil.which('docker', path=env.get('PATH', os.defpath)) != '/usr/bin/docker':
            return False
    binary = Path('/usr/bin/docker')
    info = binary.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022):
        return False
    with binary.open('rb') as stream:
        return stream.read(4) == b'\x7fELF'


def resolved_home(environment):
    """Match Docker's Linux HOME, then current-user home, without a subprocess."""
    try:
        home = environment.get('HOME') or pwd.getpwuid(os.getuid()).pw_dir
        return Path(home) if home and Path(home).is_absolute() else None
    except (KeyError, OSError, TypeError, ValueError):
        return None


def qualified_socket(root, filename, inherited):
    """Return a proven local socket, or preserve the original CLI unchanged."""
    try:
        spec = importlib.util.spec_from_file_location('inspect_compose', Path(__file__).with_name('compose.py'))
        compose = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(compose)
        protected = compose.environment(root, filename, inherited)
        if (any(inherited.get(key, '') != protected.get(key, '') for key in SELECTORS)
                or not standard_docker(inherited, protected)):
            return None
        # Custom/rootless/remote configurations remain the CLI's responsibility.
        if any(inherited.get(key) for key in ('DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_TLS',
                                              'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_CUSTOM_HEADERS')):
            return None
        if inherited.get('DOCKER_HOST', '') not in ('', 'unix://' + DEFAULT_SOCKET):
            return None
        if inherited.get('DOCKER_API_VERSION') and not API_MIN <= api_version(inherited['DOCKER_API_VERSION']) <= API_MAX:
            return None
        home = resolved_home(inherited)
        if home is None or home != resolved_home(protected):
            return None
        config = home / '.docker/config.json'
        try:
            descriptor = os.open(config, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            # A dangling link is an unreadable configuration, not an absent one.
            if os.path.lexists(config):
                return None
            value = {}
        else:
            with os.fdopen(descriptor, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > CONFIG_LIMIT:
                    return None
                raw = stream.read(CONFIG_LIMIT + 1)
                if len(raw) > CONFIG_LIMIT:
                    return None
                value = json_document(raw)
        if not isinstance(value, dict):
            return None
        # Go's JSON decoder also accepts case-insensitive field names. Do not
        # overlook a custom context/header because its spelling differs.
        folded = {key.lower(): item for key, item in value.items()}
        if (len(folded) != len(value) or folded.get('currentcontext', '') not in ('', 'default')
                or folded.get('httpheaders', {}) != {}):
            return None
        info = Path(DEFAULT_SOCKET).stat()
        return DEFAULT_SOCKET if stat.S_ISSOCK(info.st_mode) and info.st_uid == 0 else None
    except (OSError, ValueError, TypeError, AttributeError, InspectionError, RecursionError):
        return None


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=15)
        self.unix_path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.unix_path)


def request_json(connection, path, maximum):
    connection.request('GET', path, headers={'Accept': 'application/json'})
    response = connection.getresponse()
    if response.status != 200:
        raise InspectionError()
    headers = response.getheaders()
    if sum(len(key) + len(value) for key, value in headers) > VERSION_LIMIT:
        raise InspectionError()
    lengths = [value for key, value in headers if key.lower() == 'content-length']
    transfer = response.getheader('Transfer-Encoding', '').lower()
    if (len(lengths) > 1 or transfer not in ('', 'chunked') or (transfer and lengths)
            or response.getheader('Content-Encoding', 'identity').lower() != 'identity'
            or response.getheader('Content-Type', '').partition(';')[0].strip().lower() != 'application/json'):
        raise InspectionError()
    if lengths and (not re.fullmatch(r'[0-9]+', lengths[0]) or int(lengths[0]) > maximum):
        raise InspectionError()
    raw = response.read(maximum + 1)
    if len(raw) > maximum or response.length not in (None, 0):
        raise InspectionError()
    return json_document(raw)


def negotiated_version(connection, override):
    if override:
        version = api_version(override)
        if not API_MIN <= version <= API_MAX:
            raise InspectionError()
        # Docker's explicit API override disables negotiation.
        return override
    value = request_json(connection, '/version', VERSION_LIMIT)
    if not isinstance(value, dict):
        raise InspectionError()
    upper = min(API_MAX, api_version(value.get('ApiVersion')))
    lower = max(API_MIN, api_version(value.get('MinAPIVersion')))
    if lower > upper:
        raise InspectionError()
    return '.'.join(str(part) for part in upper)


def projection(value):
    if not isinstance(value, dict) or not isinstance(value.get('Config'), dict) or not isinstance(value.get('State'), dict):
        raise InspectionError()
    labels, state = value['Config'].get('Labels'), value['State']
    if not isinstance(labels, dict):
        raise InspectionError()
    health = state.get('Health')
    if health is not None and not isinstance(health, dict):
        raise InspectionError()
    row = {'id': value.get('Id'), 'project': labels.get('com.docker.compose.project'),
           'service': labels.get('com.docker.compose.service'), 'running': state.get('Running'),
           'paused': state.get('Paused'), 'status': state.get('Status'),
           'health': health.get('Status') if health is not None else None}
    if (not isinstance(row['id'], str) or not re.fullmatch(r'[a-f0-9]{64}', row['id'])
            or not isinstance(row['project'], str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', row['project'])
            or row['service'] not in ('app', 'worker', 'proxy', 'mailserver', 'clamav')
            or type(row['running']) is not bool or type(row['paused']) is not bool
            or row['status'] not in ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead')
            or row['health'] not in (None, 'starting', 'healthy', 'unhealthy')):
        raise InspectionError()
    return row


def inspect_local(path, identifiers, override=''):
    connection = UnixConnection(path)
    try:
        version = negotiated_version(connection, override)
        rows = [projection(request_json(connection, '/v' + version + '/containers/' + identifier + '/json?size=false',
                                        RAW_INSPECT_LIMIT)) for identifier in identifiers]
        output = ('\n'.join(json.dumps(row, separators=(',', ':')) for row in rows) + '\n').encode()
        if len(output) > OUTPUT_LIMIT:
            raise InspectionError()
        return output
    finally:
        connection.close()


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        if (not 3 <= len(args) <= 6 or len(set(args[2:])) != len(args[2:])
                or any(not re.fullmatch(r'[a-f0-9]{64}', value) for value in args[2:])):
            raise InspectionError()
        inherited = dict(os.environ)
        endpoint = qualified_socket(args[0], args[1], inherited)
        if endpoint is None:
            # Replace this owned child: fallback gets no second deadline or retry.
            os.execvpe('docker', ['docker', 'inspect', '--type', 'container', '--format', INSPECT_FORMAT, *args[2:]], inherited)
        output = inspect_local(endpoint, args[2:], inherited.get('DOCKER_API_VERSION', ''))
        sys.stdout.buffer.write(output)
        sys.stdout.buffer.flush()
        return 0
    except (OSError, ValueError, TypeError, http.client.HTTPException, InspectionError, RecursionError):
        # Never echo daemon bodies, headers, configuration, environment or paths.
        print('DOCKER_INSPECT_READ_FAILED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
