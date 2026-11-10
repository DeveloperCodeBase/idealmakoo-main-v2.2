#!/usr/bin/env python3
"""Bounded, project-scoped service startup and read-only readiness checks.

The implementation belongs to the reviewed operations release. --root selects
the deployment's Compose wrapper/configuration, including a historical release.
Callers hold the installation's operations lock. No environment value, container
environment, health output or service log is printed.
"""
import argparse
from datetime import datetime, timezone
import http.client
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import ssl
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


SERVICES = ('app', 'worker', 'proxy')
ALL_SERVICES = (*SERVICES, 'mailserver')
OUTPUT_LIMIT = 128 * 1024
SNAPSHOT_LIMIT = 16 * 1024
POLL_SECONDS = 2
CLEANUP_SECONDS = 90
INSPECT_FORMAT = ('{"id":{{json .Id}},'
                  '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                  '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                  '"running":{{json .State.Running}},"paused":{{json .State.Paused}},'
                  '"status":{{json .State.Status}},'
                  # Caddy intentionally has no Docker HEALTHCHECK. Docker's
                  # strict Go template lookup rejects .State.Health when that
                  # map member is absent, including inside an `if` expression.
                  # A missing-key-safe lookup preserves null for the proxy;
                  # healthy() still requires health checks for app/worker/AV.
                  '"health":{{with (index .State "Health")}}{{json .Status}}{{else}}null{{end}}}')


class LifecycleError(Exception):
    def __init__(self, code, status=1):
        super().__init__(code)
        self.code = code
        self.status = status


def failed_command_snapshot(error):
    """Copy only fixed labels/numbers; observation must not replace a failure."""
    try:
        context = getattr(error, '_command_context', None)
        timing = getattr(error, '_command_timing', None)
        if (not isinstance(context, dict) or not isinstance(timing, dict)
                or context.get('class') not in {'compose-up', 'compose-ps', 'container-list',
                                               'container-inspect', 'container-start',
                                               'container-stop', 'public-readiness'}):
            return None
        services = context.get('services')
        if (not isinstance(services, (list, tuple)) or len(services) > 5
                or any(type(service) is not str or service not in (*ALL_SERVICES, 'clamav') for service in services)
                or len(set(services)) != len(services)):
            return None
        result = {'class': context['class'], 'services': list(services)}
        for name in ('elapsedSeconds', 'suppliedMaximumSeconds', 'effectiveMaximumSeconds',
                     'overallRemainingSeconds'):
            value = timing[name]
            if value is None and name == 'suppliedMaximumSeconds':
                result[name] = None
            elif type(value) in (int, float) and math.isfinite(value) and value >= 0:
                result[name] = round(value, 6)
            else:
                return None
        return result
    except BaseException:
        return None


class Cancellation:
    def __init__(self):
        self.signum = None

    def receive(self, signum, _frame):
        self.signum = self.signum or signum

    def check(self):
        if self.signum is not None:
            raise LifecycleError('INTERRUPTED', 128 + self.signum)


class Deadline:
    def __init__(self, seconds, cancellation=None, clock=time.monotonic):
        self.clock = clock
        self.end = clock() + seconds
        self.cancellation = cancellation

    def remaining(self, maximum=None):
        if self.cancellation:
            self.cancellation.check()
        remaining = self.end - self.clock()
        if remaining <= 0:
            raise LifecycleError('DEADLINE_EXCEEDED', 124)
        return remaining if maximum is None else min(remaining, maximum)


class CommandRunner:
    """Bound every child and its output; reap only the process group we create."""
    def __init__(self):
        self.termination_verified = True

    @staticmethod
    def terminate(process):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=0.25)
        except subprocess.TimeoutExpired:
            pass
        # The parent may already have exited while a descendant retains a pipe.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            raise LifecycleError('CLIENT_PROCESS_NOT_REAPED') from None

    def run(self, command, deadline, maximum=60):
        started = time.monotonic()
        effective_maximum = deadline.remaining(maximum)
        end = started + effective_maximum
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True)
        selector = selectors.DefaultSelector()
        output = {'stdout': bytearray(), 'stderr': bytearray()}
        try:
            for name in output:
                pipe = getattr(process, name)
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
            while selector.get_map():
                remaining = min(deadline.remaining(), end - time.monotonic())
                if remaining <= 0:
                    raise LifecycleError('COMMAND_TIMEOUT', 124)
                for key, _ in selector.select(min(remaining, 0.1)):
                    data = os.read(key.fileobj.fileno(), 8192)
                    if not data:
                        selector.unregister(key.fileobj)
                    else:
                        output[key.data].extend(data)
                        if len(output[key.data]) > OUTPUT_LIMIT:
                            raise LifecycleError('COMMAND_OUTPUT_LIMIT')
            # EOF does not prove process exit: a client may close both pipes
            # and then stall. Keep signals and the total deadline observable.
            while True:
                remaining = min(deadline.remaining(), end - time.monotonic())
                if remaining <= 0:
                    raise LifecycleError('COMMAND_TIMEOUT', 124)
                try:
                    status = process.wait(timeout=min(remaining, 0.1))
                    break
                except subprocess.TimeoutExpired:
                    continue
            deadline.remaining()
            if status != 0:
                raise LifecycleError('COMMAND_FAILED')
            return bytes(output['stdout'])
        except BaseException as error:
            # Retain the original command's timing before termination/cleanup.
            # Read the clock/end directly: diagnostics never call remaining(),
            # mutate the deadline, or export command arguments or output.
            try:
                error._command_timing = {
                    'elapsedSeconds': max(0, time.monotonic() - started),
                    'suppliedMaximumSeconds': maximum,
                    'effectiveMaximumSeconds': effective_maximum,
                    'overallRemainingSeconds': max(0, deadline.end - deadline.clock()),
                }
            except BaseException:
                pass
            try:
                self.terminate(process)
            except (LifecycleError, OSError):
                self.termination_verified = False
            raise
        finally:
            selector.close()
            process.stdout.close()
            process.stderr.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _request, _file, _code, _message, _headers, _url):
        return None


def http_probe(url, timeout):
    """Executed in an owned bounded child: slow headers/body cannot reset its wall clock."""
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    try:
        request = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with opener.open(request, timeout=timeout) as response:
            if response.status != 200:
                return False
            raw = response.read(SNAPSHOT_LIMIT + 1)
            if len(raw) > SNAPSHOT_LIMIT:
                return False
            value = json.loads(raw)
            return (isinstance(value, dict) and value.get('status') == 'ok'
                    and value.get('database') == 'ok' and value.get('privacy') == 'ready')
    except (OSError, urllib.error.URLError, http.client.HTTPException, ValueError):
        return False


def selected_services(values):
    if not values or len(set(values)) != len(values) or any(x not in ALL_SERVICES for x in values):
        raise LifecycleError('INVALID_SERVICE_SELECTION')
    return tuple(x for x in ALL_SERVICES if x in values)


def private_json(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise LifecycleError('INVALID_SNAPSHOT_PATH')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_uid != os.geteuid() or before.st_mode & 0o077
                or before.st_size > SNAPSHOT_LIMIT):
            raise LifecycleError('INVALID_SNAPSHOT_FILE')
        raw = stream.read(SNAPSHOT_LIMIT + 1)
        after = os.fstat(stream.fileno())
        if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                or len(raw) != before.st_size):
            raise LifecycleError('SNAPSHOT_CHANGED')
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        raise LifecycleError('INVALID_SNAPSHOT_JSON') from None


class Lifecycle:
    def __init__(self, root, env_file, runner=None, clock=time.monotonic, sleeper=time.sleep):
        self.root = Path(root).resolve(strict=True)
        self.env_file = Path(env_file).resolve(strict=True)
        environment_stat = self.env_file.stat()
        if (not stat.S_ISREG(environment_stat.st_mode) or environment_stat.st_mode & 0o077
                or not (self.root / 'deploy/compose.py').is_file()):
            raise LifecycleError('INVALID_DEPLOYMENT_CONFIGURATION')
        spec = importlib.util.spec_from_file_location('lifecycle_env_file', Path(__file__).with_name('env-file.py'))
        reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reader)
        values = reader.read(self.env_file)
        self.project = values.get('COMPOSE_PROJECT_NAME', 'idealmakoo')
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', self.project):
            raise LifecycleError('INVALID_PROJECT_NAME')
        self.site_url = values.get('SITE_URL', '')
        self.services = ALL_SERVICES if reader.mail_mode(values) == 'local' else SERVICES
        self.antivirus = 'antivirus' in [x.strip() for x in values.get('COMPOSE_PROFILES', '').split(',')]
        self.runner = runner or CommandRunner()
        self.clock, self.sleep = clock, sleeper
        self.attempted = {}

    def run_command(self, command, deadline, *, command_class, services=(), maximum=60):
        try:
            return self.runner.run(command, deadline, maximum=maximum)
        except BaseException as error:
            # The context lives on this exception, not a runner-wide last
            # failure that could outlive a retryable public readiness probe.
            try:
                error._command_context = {'class': command_class, 'services': tuple(services)}
            except BaseException:
                pass
            raise

    def compose(self, arguments, deadline, *, maximum=60):
        try:
            command_class = {'up': 'compose-up', 'ps': 'compose-ps'}.get(arguments[0])
            services = tuple(value for value in arguments[1:] if value in (*ALL_SERVICES, 'clamav'))
        except BaseException:
            command_class, services = None, ()
        return self.run_command([sys.executable, str(self.root / 'deploy/compose.py'),
                                 str(self.root), str(self.env_file), *arguments], deadline, maximum=maximum,
                                command_class=command_class, services=services)

    def inspect(self, identifiers, deadline, allowed=ALL_SERVICES):
        if not identifiers:
            return {}
        if (len(identifiers) > 5 or len(set(identifiers)) != len(identifiers)
                or any(not re.fullmatch(r'[a-f0-9]{64}', x) for x in identifiers)):
            raise LifecycleError('INVALID_CONTAINER_IDENTITIES')
        # The reviewed sibling keeps one owned child/batch deadline. It uses a
        # proven default-local API endpoint or execs this same Docker CLI path;
        # historical deployment roots remain configuration data, not helper code.
        raw = self.run_command([sys.executable, str(Path(__file__).with_name('docker-inspect.py')),
                                str(self.root), str(self.env_file), *identifiers], deadline, maximum=15,
                               command_class='container-inspect', services=allowed)
        try:
            rows = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
        except (ValueError, UnicodeError):
            raise LifecycleError('INVALID_CONTAINER_OBSERVATION') from None
        result = {}
        for row in rows:
            if (not isinstance(row, dict) or set(row) != {'id', 'project', 'service', 'running', 'paused', 'status', 'health'}
                    or row['id'] not in identifiers or row['project'] != self.project
                    or row['service'] not in allowed or row['service'] in result
                    or type(row['running']) is not bool or type(row['paused']) is not bool
                    or row['status'] not in {'created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'}
                    or row['health'] not in {None, 'starting', 'healthy', 'unhealthy'}):
                raise LifecycleError('CONTAINER_IDENTITY_OR_STATE_MISMATCH')
            result[row['service']] = row
        if len(rows) != len(identifiers) or {x['id'] for x in result.values()} != set(identifiers):
            raise LifecycleError('CONTAINER_OBSERVATION_INCOMPLETE')
        return result

    def readiness_observation(self, identifiers, deadline, allowed):
        """One sample of fixed identities; only a reaped read timeout is unavailable."""
        deadline.remaining()
        if not self.runner.termination_verified:
            raise LifecycleError('CLIENT_PROCESS_NOT_REAPED')
        try:
            return self.inspect(identifiers, deadline, allowed)
        except LifecycleError as error:
            context = getattr(error, '_command_context', None)
            if (error.code != 'COMMAND_TIMEOUT' or error.status != 124
                    or not isinstance(context, dict) or context.get('class') != 'container-inspect'
                    or not self.runner.termination_verified):
                raise
            # Cancellation and the original operation deadline still win. No
            # mutation/list is repeated and no child gets a wider query budget.
            deadline.remaining()
            return None

    def discover(self, services, deadline, required=False, *, readiness=False):
        if (not services or len(set(services)) != len(services)
                or any(service not in (*ALL_SERVICES, 'clamav') for service in services)):
            raise LifecycleError('INVALID_SERVICE_SELECTION')
        # Upgrade rollback uses this reviewed implementation with an older
        # deployment root whose wrapper need not know list-existing. Its root
        # and protected environment remain data for our current sibling wrapper;
        # ordinary Compose operations still use the deployment's own wrapper.
        raw = self.run_command([sys.executable, str(Path(__file__).with_name('compose.py')),
                                str(self.root), str(self.env_file), 'list-existing', *services],
                               deadline, maximum=60, command_class='container-list', services=services)
        try:
            rows = [json.loads(line) for line in raw.decode('ascii').splitlines() if line.strip()]
        except (ValueError, UnicodeError):
            raise LifecycleError('INVALID_CONTAINER_LIST') from None
        selected = []
        for row in rows:
            if (not isinstance(row, dict) or set(row) != {'id', 'service'}
                    or not isinstance(row['id'], str) or not re.fullmatch(r'[a-f0-9]{64}', row['id'])
                    or not isinstance(row['service'], str)
                    or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', row['service'])):
                raise LifecycleError('INVALID_CONTAINER_LIST')
            if row['service'] in services:
                selected.append(row)
        # Do not deduplicate: repeated IDs or service replicas/one-offs must
        # still fail the unchanged strict identity/cardinality inspection.
        identifiers = [row['id'] for row in selected]
        if readiness:
            # This list belongs to the completed owned startup/readiness stage.
            # Keep its IDs and multiplicity; never relist or adopt a replacement.
            pinned = tuple(identifiers)
            while True:
                result = self.readiness_observation(pinned, deadline, services)
                if result is not None:
                    break
                self.pause(deadline)
        else:
            result = self.inspect(identifiers, deadline, services)
        if any(result.get(row['service'], {}).get('id') != row['id'] for row in selected):
            raise LifecycleError('CONTAINER_IDENTITY_OR_STATE_MISMATCH')
        if required and set(result) != set(services):
            raise LifecycleError('SELECTED_SERVICE_MISSING')
        return result

    def snapshot(self, path, deadline):
        # Also capture a retained/previously enabled mail writer. A changed env
        # mode cannot make its live queue disappear from a consistent snapshot.
        rows = self.discover(ALL_SERVICES, deadline)
        selected = []
        for service in ALL_SERVICES:
            row = rows.get(service)
            if row and row['paused']:
                raise LifecycleError('PAUSED_SERVICE_NOT_SUPPORTED')
            if row and row['running']:
                if row['status'] != 'running':
                    raise LifecycleError('SERVICE_STATE_NOT_STABLE')
                selected.append({'service': service, 'containerId': row['id']})
        result = {'format': 'idealmakoo.service-lifecycle-snapshot', 'version': 1,
                  'project': self.project, 'environmentPath': str(self.env_file),
                  'capturedAt': datetime.now(timezone.utc).isoformat(), 'services': selected}
        path = Path(path)
        if not path.is_absolute() or path.parent.resolve() != path.parent or not path.parent.is_dir():
            raise LifecycleError('INVALID_SNAPSHOT_PATH')
        deadline.remaining()
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(json.dumps(result, separators=(',', ':')).encode() + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def load_snapshot(self, path):
        value = private_json(path)
        if (not isinstance(value, dict) or set(value) != {'format', 'version', 'project', 'environmentPath', 'capturedAt', 'services'}
                or value['format'] != 'idealmakoo.service-lifecycle-snapshot' or type(value['version']) is not int
                or value['version'] != 1 or value['project'] != self.project
                or value['environmentPath'] != str(self.env_file) or not isinstance(value['services'], list)
                or len(value['services']) > len(ALL_SERVICES)):
            raise LifecycleError('SNAPSHOT_BINDING_MISMATCH')
        try:
            captured = datetime.fromisoformat(value['capturedAt'])
            if captured.tzinfo is None:
                raise ValueError()
        except (ValueError, TypeError):
            raise LifecycleError('INVALID_SNAPSHOT_TIMESTAMP') from None
        selected = {}
        for row in value['services']:
            if (not isinstance(row, dict) or set(row) != {'service', 'containerId'}
                    or row['service'] not in ALL_SERVICES or row['service'] in selected
                    or not isinstance(row['containerId'], str)
                    or not re.fullmatch(r'[a-f0-9]{64}', row['containerId'])):
                raise LifecycleError('INVALID_SNAPSHOT_SELECTION')
            selected[row['service']] = row['containerId']
        if len(set(selected.values())) != len(selected) or list(selected) != [x for x in ALL_SERVICES if x in selected]:
            raise LifecycleError('INVALID_SNAPSHOT_SELECTION')
        return selected

    def verify_identities(self, mapping, deadline, *, readiness=False):
        rows = (self.readiness_observation(tuple(mapping.values()), deadline, tuple(mapping))
                if readiness else self.inspect(list(mapping.values()), deadline, tuple(mapping)))
        if rows is None:
            return None
        if {name: row['id'] for name, row in rows.items()} != mapping:
            raise LifecycleError('SELECTED_CONTAINER_CHANGED')
        return rows

    def pause(self, deadline):
        self.sleep(min(POLL_SECONDS, deadline.remaining()))

    def healthy(self, row):
        if row['paused'] or row['status'] in {'created', 'removing', 'exited', 'dead'} or not row['running']:
            raise LifecycleError('SERVICE_NOT_RUNNING')
        if row['service'] == 'proxy':
            return row['status'] == 'running'
        if row['health'] is None:
            raise LifecycleError('SERVICE_HEALTHCHECK_MISSING')
        if row['health'] == 'unhealthy':
            raise LifecycleError('SERVICE_UNHEALTHY')
        return row['status'] == 'running' and row['health'] == 'healthy'

    def wait_healthy(self, mapping, deadline):
        while True:
            rows = self.verify_identities(mapping, deadline, readiness=True)
            if rows is not None and all(self.healthy(rows[name]) for name in mapping):
                return
            self.pause(deadline)

    def public_url(self):
        try:
            parsed = urllib.parse.urlsplit(self.site_url)
            if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
                    or parsed.username is not None or parsed.password is not None
                    or parsed.query or parsed.fragment):
                raise ValueError()
            _ = parsed.port
        except (ValueError, TypeError):
            raise LifecycleError('INVALID_PUBLIC_READINESS_URL') from None
        return self.site_url.rstrip('/') + '/api/v1/health/ready'

    def public_ready(self, deadline):
        if not self.runner.termination_verified:
            raise LifecycleError('CLIENT_PROCESS_NOT_REAPED')
        try:
            timeout = deadline.remaining(12)
            self.run_command([sys.executable, str(Path(__file__).resolve()), '--readiness-probe',
                              self.public_url(), str(timeout)], deadline, maximum=timeout,
                             command_class='public-readiness', services=('proxy',))
            if not self.runner.termination_verified:
                raise LifecycleError('CLIENT_PROCESS_NOT_REAPED')
            return True
        except LifecycleError as error:
            # Probe errors, resets, invalid JSON and its own 12s wall-clock limit
            # are transient. The overall deadline and signals remain failures.
            deadline.remaining()
            if not self.runner.termination_verified:
                raise
            if error.code in {'COMMAND_FAILED', 'COMMAND_TIMEOUT', 'COMMAND_OUTPUT_LIMIT'}:
                return False
            raise

    def wait_ready(self, mapping, deadline, scanner=False, *, require_public=True):
        if not mapping:
            return
        observed = dict(mapping)
        if scanner and self.antivirus:
            scanner_rows = self.discover(('clamav',), deadline, required=True, readiness=True)
            observed['clamav'] = scanner_rows['clamav']['id']
        while True:
            rows = self.verify_identities(observed, deadline, readiness=True)
            ready = rows is not None and all(self.healthy(rows[name]) for name in observed)
            if ready and ('proxy' not in mapping or not require_public or self.public_ready(deadline)):
                # Do not accept a stale earlier stage after the public request.
                final = self.verify_identities(observed, deadline, readiness=True)
                if final is not None and all(self.healthy(final[name]) for name in observed):
                    return
                # An unavailable final sample restarts health -> public -> final
                # proof; a previous successful HTTP probe is never carried over.
            self.pause(deadline)

    def stop(self, mapping, deadline):
        if not mapping:
            return
        self.verify_identities(mapping, deadline)
        identifiers = [mapping[name] for name in reversed(ALL_SERVICES) if name in mapping]
        error = None
        try:
            self.run_command(['docker', 'stop', '--time', '60', *identifiers], deadline, maximum=90,
                             command_class='container-stop', services=tuple(mapping))
        except LifecycleError as caught:
            error = caught
        rows = self.verify_identities(mapping, deadline)
        if any(row['running'] for row in rows.values()):
            raise error or LifecycleError('SELECTED_SERVICES_NOT_STOPPED')
        if error:
            raise error

    def start(self, services, deadline, existing=None):
        mapping = {} if existing is None else dict(existing)
        if existing is not None:
            self.verify_identities(mapping, deadline)
        if 'proxy' in services:
            self.public_url()
        for service in services:
            deadline.remaining()
            if existing is None:
                # Record ownership before the call, including a partial up failure.
                self.attempted[service] = None
                # Mutating startup shares the caller's finite operation budget;
                # read-only Compose discovery retains its shorter command cap.
                self.compose(['up', '-d', '--no-deps', '--no-build', '--pull', 'never', service], deadline,
                             maximum=None)
                row = self.discover((service,), deadline, required=True, readiness=True)[service]
                mapping[service] = row['id']
                self.attempted[service] = row['id']
            else:
                self.attempted[service] = mapping[service]
                self.run_command(['docker', 'start', mapping[service]], deadline, maximum=None,
                                 command_class='container-start', services=(service,))
            self.wait_healthy({service: mapping[service]}, deadline)
            previous = {name: mapping[name] for name in services if name in self.attempted}
            self.wait_healthy(previous, deadline)
        # Resume only the captured subset. An intentionally stopped app cannot
        # serve HTTP for a restored proxy; new up and explicit check still can
        # require public readiness even when app is not selected by the caller.
        self.wait_ready(mapping, deadline,
                        require_public=existing is None or ('app' in mapping and 'proxy' in mapping))

    def cleanup(self):
        if not self.attempted:
            return None
        # The primary failure/signal remains authoritative. Cleanup has its own
        # fixed budget and cannot be cancelled repeatedly into an endless retry.
        deadline = Deadline(CLEANUP_SECONDS, clock=self.clock)
        mapping = {}
        try:
            for service, identifier in self.attempted.items():
                if identifier is None:
                    row = self.discover((service,), deadline).get(service)
                    if row:
                        mapping[service] = row['id']
                else:
                    mapping[service] = identifier
            self.stop(mapping, deadline)
            return True
        except Exception:
            # Even malformed daemon observations or cleanup I/O must never
            # replace the original startup failure or its signal exit status.
            return False


def seconds(value):
    if not re.fullmatch(r'[1-9][0-9]{0,3}', value) or not 1 <= int(value) <= 3600:
        raise argparse.ArgumentTypeError('Timeout must be a whole number from 1 to 3600 seconds.')
    return int(value)


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--env-file', required=True)
    sub = parser.add_subparsers(dest='operation', required=True)
    listing = sub.add_parser('ps', help='Read-only project listing with a bounded client lifetime.')
    listing.add_argument('--timeout', type=seconds, default=15)
    snapshot = sub.add_parser('snapshot')
    snapshot.add_argument('--output', required=True)
    snapshot.add_argument('--timeout', type=seconds, default=30)
    for name in ('start', 'stop'):
        action = sub.add_parser(name)
        action.add_argument('--snapshot', required=name == 'start')
        action.add_argument('--timeout', type=seconds, default=1200 if name == 'start' else 90)
        if name == 'stop':
            action.add_argument('services', nargs='*')
    for name in ('up', 'check'):
        action = sub.add_parser(name)
        action.add_argument('--timeout', type=seconds, default=1200 if name == 'up' else 240)
        action.add_argument('services', nargs='*')
    return parser.parse_args(argv)


def main(argv=None):
    args = arguments(argv)
    cancellation = Cancellation()
    previous = {sig: signal.signal(sig, cancellation.receive) for sig in (signal.SIGINT, signal.SIGTERM)}
    lifecycle = None
    try:
        deadline = Deadline(args.timeout, cancellation)
        lifecycle = Lifecycle(args.root, args.env_file)
        deadline.remaining()
        if args.operation == 'ps':
            sys.stdout.buffer.write(lifecycle.compose(['ps'], deadline))
            sys.stdout.buffer.flush()
        elif args.operation == 'snapshot':
            lifecycle.snapshot(args.output, deadline)
        elif args.operation in ('start', 'stop'):
            if args.operation == 'stop' and args.snapshot and args.services:
                raise LifecycleError('SNAPSHOT_AND_SERVICE_SELECTION_CONFLICT')
            if args.snapshot:
                mapping = lifecycle.load_snapshot(args.snapshot)
            else:
                services = selected_services(args.services)
                rows = lifecycle.discover(services, deadline)
                mapping = {name: row['id'] for name, row in rows.items()}
            if args.operation == 'start':
                lifecycle.start(tuple(mapping), deadline, existing=mapping)
            else:
                lifecycle.stop(mapping, deadline)
        else:
            services = selected_services(args.services or list(lifecycle.services))
            if args.operation == 'up':
                lifecycle.start(services, deadline)
            else:
                rows = lifecycle.discover(services, deadline, required=True)
                lifecycle.wait_ready({name: row['id'] for name, row in rows.items()}, deadline, scanner=True)
        cancellation.check()
        if not lifecycle.runner.termination_verified:
            raise LifecycleError('CLIENT_PROCESS_NOT_REAPED')
        return 0
    except Exception as error:
        status = error.status if isinstance(error, LifecycleError) else 1
        code = error.code if isinstance(error, LifecycleError) else 'LIFECYCLE_CONFIGURATION_OR_IO_FAILED'
        failed_command = failed_command_snapshot(error)
        cleanup = lifecycle.cleanup() if lifecycle is not None and args.operation in ('up', 'start') else None
        result = {'operation': args.operation, 'code': code, 'exitCode': status,
                  'cleanupAttempted': cleanup is not None, 'cleanupVerified': cleanup,
                  'clientProcessTerminationVerified': lifecycle.runner.termination_verified if lifecycle else None}
        if failed_command is not None:
            result['failedCommand'] = failed_command
        print(json.dumps(result), file=sys.stderr)
        return status
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--readiness-probe':
        try:
            probe_timeout = float(sys.argv[3])
            if not 0 < probe_timeout <= 12:
                raise ValueError()
            raise SystemExit(0 if http_probe(sys.argv[2], probe_timeout) else 1)
        except (ValueError, OSError):
            raise SystemExit(1) from None
    raise SystemExit(main())
