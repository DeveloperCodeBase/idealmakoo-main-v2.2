#!/bin/sh
# Configuration lives in private tmpfs; signatures are the only persistent writes.
set -eu
umask 077
clamd_pid=''; freshclam_pid=''
# Called by EXIT/INT/TERM traps, not through a direct function invocation.
# shellcheck disable=SC2317,SC2329
cleanup() {
  result=$?
  trap - EXIT INT TERM
  for child in "$clamd_pid" "$freshclam_pid"; do
    if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; fi
  done
  wait 2>/dev/null || true
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cat > /tmp/clamd.conf <<'CONFIG'
DatabaseDirectory /var/lib/clamav
Foreground yes
TCPSocket 3310
TCPAddr 0.0.0.0
LocalSocket /tmp/clamd.sock
FixStaleSocket yes
PidFile /tmp/clamd.pid
LogTime yes
MaxThreads 2
MaxQueue 8
StreamMaxLength 96M
MaxFileSize 96M
MaxScanSize 192M
MaxRecursion 16
MaxFiles 10000
MaxScanTime 120000
# An incomplete scan must not look clean merely because a limit was reached.
AlertExceedsMax yes
# Encrypted containers/documents cannot be fully inspected without their key.
AlertEncrypted yes
CONFIG
cat > /tmp/freshclam.conf <<'CONFIG'
DatabaseDirectory /var/lib/clamav
DatabaseOwner clamav
DatabaseMirror database.clamav.net
Foreground yes
PidFile /tmp/freshclam.pid
ConnectTimeout 30
ReceiveTimeout 120
Checks 6
CONFIG
if [ ! -s /var/lib/clamav/main.cvd ] && [ ! -s /var/lib/clamav/main.cld ]; then
  # No clean result is possible until an actual signature database is available.
  freshclam --config-file=/tmp/freshclam.conf --stdout
fi
clamd --config-file=/tmp/clamd.conf --foreground &
clamd_pid=$!
freshclam --config-file=/tmp/freshclam.conf --daemon --foreground --stdout &
freshclam_pid=$!
while kill -0 "$clamd_pid" 2>/dev/null && kill -0 "$freshclam_pid" 2>/dev/null; do
  sleep 5
done
# A dead scanner/updater must terminate the container so restart policy applies.
exit 1
