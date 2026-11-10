#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EUID" == 0 ]] || { printf '%s\n' 'Run as root.' >&2; exit 1; }
mail_app_dir="${1:?Installation root required}"
mail_project="${2:?Project name required}"
[[ "$mail_app_dir" =~ ^/[A-Za-z0-9_./-]+$ && "$mail_project" =~ ^[a-z0-9][a-z0-9_-]{0,39}$ ]] || exit 1
unit="idealmakoo-$mail_project-mail-tls"
for suffix in service timer; do
  file="/etc/systemd/system/$unit.$suffix"
  if [[ -e "$file" ]] && ! grep -Fqx "# Managed for $mail_app_dir" "$file"; then
    printf '%s\n' 'An unrelated systemd unit was not overwritten.' >&2; exit 1
  fi
done
cat > "/etc/systemd/system/$unit.service" <<EOF
# Managed for $mail_app_dir
[Unit]
Description=Renewed domain mail certificate readiness for $mail_project
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
UMask=0077
WorkingDirectory=$mail_app_dir/current
ExecStart=/usr/bin/bash $mail_app_dir/current/scripts/mail-certificate-refresh.sh
TimeoutStartSec=420
NoNewPrivileges=true
PrivateTmp=true
EOF
cat > "/etc/systemd/system/$unit.timer" <<EOF
# Managed for $mail_app_dir
[Unit]
Description=Check domain mail certificate renewal for $mail_project
[Timer]
OnBootSec=10m
OnUnitActiveSec=1h
RandomizedDelaySec=2m
Persistent=true
[Install]
WantedBy=timers.target
EOF
chmod 0644 "/etc/systemd/system/$unit.service" "/etc/systemd/system/$unit.timer"
systemctl daemon-reload
systemctl enable --now "$unit.timer"
