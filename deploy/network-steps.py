#!/usr/bin/env python3
"""Bounded retry for explicitly repeatable download steps; never execute a shell.

Child output is private and capped. Public results contain fixed reason codes,
counts and actionable guidance, never command arguments or provider credentials.
Configuration, certificate and signature failures are never retried.
"""
import argparse
import json
import os
import re
import selectors
import signal
import subprocess
import sys
import time

LIMIT = 1024 * 1024
GUIDANCE = {
    'TLS_TRUST': 'Check host clock and approved CA chain. Use BUILD_CA_CERT_FILE for an organization CA; never disable TLS verification.',
    'SIGNATURE': 'Stop. Verify the official repository signing key, release checksum and package source before retrying.',
    'AUTHORIZATION': 'Review provider access, registry login or permitted network route. Do not switch to an unverified mirror.',
    'DNS': 'Check DNS resolution on this host and Docker. Use a provider-approved resolver or an explicitly configured trusted registry.',
    'NETWORK': 'Check outbound connectivity, approved proxy and provider status; rerun the same installation after access is restored.',
    'RATE_LIMIT': 'The provider rate-limited this operation. Wait for its limit to reset or authenticate with an authorized account.',
    'DISK': 'Free space in this installation/build cache after inspecting ownership. Do not remove unrelated Docker volumes.',
    'TIMEOUT': 'The bounded download deadline expired. Check network latency/access; rerun after resolving the cause.',
    'CONFIGURATION': 'Review installation settings and reproduce only the named step in a private terminal. Later installation stages were not run.',
    'OUTPUT_LIMIT': 'The step exceeded its private output budget. Inspect the source/configuration before rerunning.',
    'INTERRUPTED': 'The operation was interrupted; its owned child was terminated. Existing data is preserved.',
}

def classify(data, status):
    text = data.decode('utf-8', 'replace').lower()
    if re.search(r'certificate.*(verify|expired|unknown)|self.signed|tls.*(certificate|handshake)|x509:', text): return 'TLS_TRUST'
    if re.search(r'no_pubkey|badsig|expkeysig|signature.*(invalid|verify|failed)|integrity checksum|eintegrity|hash sum mismatch|unauthenticated packages', text): return 'SIGNATURE'
    if re.search(r'no space left|disk quota exceeded', text): return 'DISK'
    if re.search(r'429|toomanyrequests|too many requests|rate.limit', text): return 'RATE_LIMIT'
    if re.search(r'401|403|unauthorized|access denied|permission denied|forbidden', text): return 'AUTHORIZATION'
    if re.search(r'could not resolve|temporary failure resolving|name or service not known|eai_again|enotfound|no such host', text): return 'DNS'
    if re.search(r'connection (reset|refused|timed out)|network is unreachable|network unreachable|econnreset|etimedout|unexpected eof|502|503|504|timeout', text): return 'NETWORK'
    return 'CONFIGURATION'

def capture(command, timeout, environment=None):
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, env=environment, start_new_session=True)
    output = bytearray(); reason = None; started = time.monotonic(); deadline = started + timeout
    heartbeat = started + 20
    interrupted = [None]
    def cancel(signum, frame):
        interrupted[0] = signum
        raise KeyboardInterrupt()
    previous = {sig: signal.signal(sig, cancel) for sig in (signal.SIGTERM, signal.SIGINT)}
    selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0: reason = 'TIMEOUT'; break
            if time.monotonic() >= heartbeat:
                print(json.dumps({'status': 'running', 'elapsedSeconds': int(time.monotonic() - started)}), file=sys.stderr, flush=True)
                heartbeat = time.monotonic() + 20
            for key, _ in selector.select(min(remaining, .25)):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk: selector.unregister(key.fileobj); continue
                output.extend(chunk)
                if len(output) > LIMIT: reason = 'OUTPUT_LIMIT'; break
            if reason: break
        if not reason:
            try: status = process.wait(timeout=max(.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired: reason = 'TIMEOUT'
    except (KeyboardInterrupt, SystemExit):
        reason = 'INTERRUPTED'
    finally:
        selector.close()
        if reason:
            try: os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(timeout=3)
        process.stdout.close()
        for sig, handler in previous.items(): signal.signal(sig, handler)
    return (124 if reason == 'TIMEOUT' else 128 + (interrupted[0] or signal.SIGINT) if reason == 'INTERRUPTED' else 1 if reason else status), bytes(output[:LIMIT]), reason

def run_step(label, command, attempts=3, timeout=300, runner=capture, sleeper=time.sleep):
    if label not in {'apt-update', 'apt-install', 'docker-key', 'image-pull', 'image-build'}:
        raise ValueError('Only reviewed repeatable download steps are supported')
    if not 1 <= attempts <= 4 or not 5 <= timeout <= 3600 or not command:
        raise ValueError('Invalid bounded retry configuration')
    for attempt in range(1, attempts + 1):
        status, output, forced = runner(command, timeout)
        if status == 0:
            print(json.dumps({'step': label, 'status': 'ready', 'attempts': attempt}), file=sys.stderr)
            return 0
        reason = forced or classify(output, status)
        retry = reason in {'DNS', 'NETWORK', 'RATE_LIMIT', 'TIMEOUT'} and attempt < attempts
        print(json.dumps({'step': label, 'status': 'retry' if retry else 'stopped', 'attempt': attempt,
                          'reason': reason, 'help': GUIDANCE[reason]}), file=sys.stderr)
        if not retry: return status if 1 <= status <= 255 else 1
        sleeper(min(2 ** attempt, 8))
    return 1

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('step'); p.add_argument('--attempts', type=int, default=3)
    p.add_argument('--timeout', type=int, default=300); p.add_argument('command', nargs=argparse.REMAINDER)
    a = p.parse_args(); command = a.command[1:] if a.command[:1] == ['--'] else a.command
    return run_step(a.step, command, a.attempts, a.timeout)

if __name__ == '__main__':
    try: raise SystemExit(main())
    except (ValueError, OSError): raise SystemExit('Download configuration/execution failed; no later step was run.') from None
