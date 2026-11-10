#!/usr/bin/env python3
"""Persist one disposable private Lighthouse run across terminal disconnects."""
import argparse
import datetime
import json
import os
from pathlib import Path
import signal
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--chrome', required=True)
    parser.add_argument('--base-url', default='http://127.0.0.1:3080')
    parser.add_argument('--device', choices=['mobile', 'desktop'], default='mobile')
    parser.add_argument('--label', required=True)
    parser.add_argument('--pilot', action='store_true')
    parser.add_argument('--inventory-only', action='store_true')
    parser.add_argument('--retry-errors', action='store_true')
    parser.add_argument('--allow-root-chrome', action='store_true')
    parser.add_argument('--swiftshader-driver', action='store_true',
                        help='Use the explicit ANGLE CPU software driver; this does not use a physical GPU.')
    parser.add_argument('--no-full-page-screenshot', action='store_true',
                        help='Omit only the optional report image; preserve trace screenshots and all scored audits.')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--deadline-seconds', type=int, default=300)
    parser.add_argument('--detach', action='store_true')
    args = parser.parse_args()
    if not args.label.replace('-', '').replace('_', '').isalnum():
        parser.error('Use only letters, numbers, underscores and hyphens in a supervisor label.')
    if args.limit is not None and args.limit < 1:
        parser.error('The optional limit must be positive.')
    if not 60 <= args.deadline_seconds <= 900:
        parser.error('Each URL needs a deadline between 60 and 900 seconds.')
    env_file = Path(args.env_file).resolve(strict=True)
    chrome = Path(args.chrome).resolve(strict=True)
    if not env_file.is_file() or not chrome.is_file():
        parser.error('The environment file and Chrome executable must be existing files.')
    root = Path(__file__).resolve().parents[1]
    build_id = (root / '.next/BUILD_ID').read_text().strip()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.chmod(0o700)
    status_file = output / (args.label + '.supervisor-status.json')
    log_file = output / (args.label + '.supervisor.log')
    pid_file = output / (args.label + '.supervisor.pid')
    if any(file.exists() for file in (status_file, log_file, pid_file)):
        parser.error('Choose a fresh supervisor label; previous attempts and logs are retained.')
    if args.detach:
        command = [sys.executable, str(Path(__file__).resolve()),
                   *[value for value in sys.argv[1:] if value != '--detach']]
        child = subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
        print(json.dumps({'supervisorPid': child.pid, 'statusFile': str(status_file),
                          'logFile': str(log_file)}))
        return 0

    # Node loads secrets from the explicit existing file. Neither this command,
    # the job files nor the supervisor status serialize its contents or cookies.
    # The child still requires the explicit opt-in marker and every database,
    # loopback, production-mode and outbound-provider guard.
    command = ['node', '--env-file=' + str(env_file), '--import', 'tsx',
               'scripts/audit-private-lighthouse.mjs', '--base-url', args.base_url,
               '--output', str(output), '--chrome', str(chrome), '--device', args.device,
               '--deadline-seconds', str(args.deadline_seconds)]
    for name in ('pilot', 'inventory_only', 'retry_errors', 'allow_root_chrome', 'swiftshader_driver', 'no_full_page_screenshot'):
        if getattr(args, name):
            command.append('--' + name.replace('_', '-'))
    if args.limit is not None:
        command.extend(['--limit', str(args.limit)])
    now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    state = {'state': 'starting', 'startedAt': now(), 'supervisorPid': os.getpid(),
             'buildId': build_id,
             'command': command, 'output': str(output), 'logFile': str(log_file)}
    sequence = 0

    def save():
        nonlocal sequence
        sequence += 1
        # A signal handler can run while a prior state write is in progress.
        # Independent temporary names keep that handler able to forward SIGTERM.
        temporary = status_file.with_name(status_file.name + f'.{os.getpid()}.{sequence}.tmp')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(json.dumps(state, indent=2) + '\n')
        temporary.replace(status_file)

    fd = os.open(pid_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        handle.write(str(os.getpid()) + '\n')
    save()
    child = None

    def forward(signum, _frame):
        state.update(requestedSignal=signal.Signals(signum).name, signalAt=now())
        save()
        if child is not None and child.poll() is None:
            # Only this exact Node child. The runner owns its individual Chrome
            # PID/profile deadlines and revocation of its own fixture sessions.
            try:
                os.kill(child.pid, signum)
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, forward)
    signal.signal(signal.SIGINT, forward)
    exit_code = 2
    try:
        fd = os.open(log_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as log:
            child = subprocess.Popen(command, cwd=root, env=os.environ.copy(),
                                     stdin=subprocess.DEVNULL, stdout=log,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            state.update(state='running', childPid=child.pid)
            save()
            exit_code = child.wait()
        state.update(state='completed', finishedAt=now(), exitCode=exit_code)
    except BaseException as error:
        state.update(state='supervisor-error', finishedAt=now(),
                     errorType=type(error).__name__)
        raise
    finally:
        save()
    return 0 if exit_code == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
