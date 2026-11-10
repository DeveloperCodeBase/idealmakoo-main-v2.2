#!/usr/bin/env python3
"""Read-only HTTPS access diagnosis. Does not install packages or send messages."""
import argparse
import importlib.util
import json
from pathlib import Path
import ssl
import socket
import urllib.error
import urllib.parse
import urllib.request

TARGETS = {'docker-packages': 'https://download.docker.com/linux/ubuntu/gpg',
           'docker-registry': 'https://registry-1.docker.io/v2/',
           'npm-registry': 'https://registry.npmjs.org/-/ping',
           'mail-registry': 'https://ghcr.io/v2/',
           'acme': 'https://acme-v02.api.letsencrypt.org/directory'}

def probe(label, url, opener=urllib.request.urlopen):
    try:
        with opener(urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'IdealMakoo-preflight/2.2'}),
                    timeout=8, context=ssl.create_default_context()) as response:
            code = response.status
        return {'target': label, 'ready': 200 <= code < 400, 'reason': 'OK' if code < 400 else 'HTTP_ACCESS'}
    except urllib.error.HTTPError as e:
        # Registry authentication challenges prove HTTPS reachability, not pull rights.
        return {'target': label, 'ready': e.code == 401 and label.endswith('registry'),
                'reason': 'AUTH_CHALLENGE' if e.code == 401 and label.endswith('registry') else 'HTTP_ACCESS'}
    except urllib.error.URLError as e:
        reason = 'TLS_TRUST' if isinstance(e.reason, ssl.SSLError) else 'DNS' if isinstance(e.reason, socket.gaierror) else 'NETWORK'
        return {'target': label, 'ready': False, 'reason': reason}
    except (OSError, ValueError): return {'target': label, 'ready': False, 'reason': 'NETWORK'}

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--env-file'); p.add_argument('--without-mail', action='store_true'); a = p.parse_args()
    targets = dict(TARGETS)
    if a.without_mail: targets.pop('mail-registry')
    if a.env_file:
        spec = importlib.util.spec_from_file_location('preflight_env', Path(__file__).with_name('env-file.py'))
        reader = importlib.util.module_from_spec(spec); spec.loader.exec_module(reader)
        values = reader.read(a.env_file)
        registry = values.get('BUILD_NPM_REGISTRY', '')
        if registry:
            u = urllib.parse.urlsplit(registry)
            if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment:
                raise ValueError('BUILD_NPM_REGISTRY must be a credential-free HTTPS URL')
            targets['npm-registry'] = registry.rstrip('/') + '/-/ping'
    results = [probe(k, v) for k, v in targets.items()]
    print(json.dumps({'format': 1, 'checks': results, 'scope': 'HTTPS reachability only; not DNS ownership, provider authorization or delivery acceptance'}, indent=2))
    return 0 if all(x['ready'] for x in results) else 1

if __name__ == '__main__':
    try: raise SystemExit(main())
    except (ValueError, OSError): raise SystemExit('Preflight settings could not be read safely.') from None
