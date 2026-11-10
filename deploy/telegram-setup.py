#!/usr/bin/env python3
"""Plan or explicitly register this site's Telegram verification webhook.

Credentials are read only from the protected environment file. The default plan
does not contact Telegram. --apply changes the webhook but never sends a message.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location('telegram_setup_env', Path(__file__).with_name('env-file.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def configuration(values):
    site = values.get('SITE_URL', '').rstrip('/')
    parsed = urllib.parse.urlsplit(site)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443)
            or any(ord(c) < 33 for c in site)):
        raise ValueError('Use the public HTTPS site origin without a path or custom port')
    token = values.get('TELEGRAM_BOT_TOKEN', '')
    username = values.get('TELEGRAM_BOT_USERNAME', '')
    secret = values.get('TELEGRAM_WEBHOOK_SECRET', '')
    if not re.fullmatch(r'[0-9]{5,20}:[A-Za-z0-9_-]{20,200}', token):
        raise ValueError('Set the bot token in the protected environment file')
    if not re.fullmatch(r'[A-Za-z0-9_]{5,32}', username):
        raise ValueError('Set the bot username without @')
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', secret):
        raise ValueError('Set an independent webhook secret with 32..256 allowed characters')
    return {'url': site + '/api/v1/communication-channels/telegram-webhook',
            'token': token, 'username': username, 'secret_token': secret}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Telegram API redirect refused')


def api(values, config, method, body):
    if method not in {'getMe', 'setWebhook', 'getWebhookInfo'}:
        raise ValueError('Unsupported setup operation')
    proxy = reader.runtime_proxy(values)
    handler = urllib.request.ProxyHandler(
        {key.lower(): proxy.get('RUNTIME_' + key + '_PROXY', '') for key in ('HTTP', 'HTTPS')}
        if proxy['RUNTIME_USE_ENV_PROXY'] == '1' else None)
    opener = urllib.request.build_opener(handler, NoRedirect(),
                                        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request = urllib.request.Request('https://api.telegram.org/bot' + config['token'] + '/' + method,
                                     data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json'})
    try:
        with opener.open(request, timeout=20) as response:
            raw = response.read(262145)
        if len(raw) > 262144:
            raise ValueError('Telegram setup response exceeds its limit')
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get('ok') is not True or 'result' not in result:
            raise ValueError('Telegram refused this setup operation')
        return result['result']
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        raise ValueError('Telegram setup failed; check the protected token, HTTPS access and approved proxy. No message was sent.') from None


def apply(values, call=api):
    config = configuration(values)
    me = call(values, config, 'getMe', {})
    if (not isinstance(me, dict) or me.get('is_bot') is not True
            or me.get('username', '').lower() != config['username'].lower()
            or str(me.get('id', '')) != config['token'].split(':', 1)[0]):
        raise ValueError('The configured bot username and token identify different bots')
    body = {'url': config['url'], 'secret_token': config['secret_token'],
            'allowed_updates': ['message'], 'drop_pending_updates': False}
    if call(values, config, 'setWebhook', body) is not True:
        raise ValueError('Telegram did not acknowledge webhook registration')
    info = call(values, config, 'getWebhookInfo', {})
    if not isinstance(info, dict) or info.get('url') != config['url']:
        raise ValueError('Webhook registration could not be verified')
    return {'status': 'registered', 'url': config['url'], 'messagesSent': 0,
            'pendingUpdates': info.get('pending_update_count', 0),
            'lastDeliveryErrorPresent': bool(info.get('last_error_date')),
            'scope': 'Registration checked; complete account linking in the website to prove end-to-end delivery.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--apply', action='store_true', help='Register the webhook at Telegram after checking bot identity')
    args = parser.parse_args()
    path = Path(args.env_file)
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError('Use a real protected environment file with mode 600')
    values = reader.read(path)
    config = configuration(values)
    result = apply(values) if args.apply else {
        'status': 'plan', 'url': config['url'], 'botUsername': config['username'],
        'allowedUpdates': ['message'], 'dropPendingUpdates': False, 'networkCalls': 0,
        'next': 'Review the public URL and dedicated bot identity, then rerun with --apply.'}
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError):
        raise SystemExit('Telegram setup stopped. Verify the protected file, HTTPS site URL, matching bot identity and network access; secret values were not printed.') from None
