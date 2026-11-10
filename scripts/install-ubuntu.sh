#!/usr/bin/env bash
# Reviewed local installer: never pipes downloaded shell code into an interpreter.
set -Eeuo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
SOURCE_ROOT="$PROJECT_ROOT"
domain=""; email=""; admin_email=""; app_dir=/var/www/idealmakoo
project_name=idealmakoo; http=0; http_port=80; https_port=443; bind_ip=0.0.0.0
antivirus=1; resource_check=1; backup_timer=1
mail_mode=auto; mail_mode_explicit=0
najva_worker_file=""; input_env=""; app_dir_set=0; project_set=0; http_port_set=0; https_port_set=0; bind_set=0; antivirus_set=0
recovery_payload=""; recovery_identity=""; recovery_latest_ledger=""; recovery_activate_outbound=0
install_phase=preflight; release_dir=""; previous=""; safety_backup=""; stop_writers_on_failure=0
installation_finished() {
  local status=$?
  (( status == 0 )) && return
  trap - EXIT INT TERM
  log "Installation stopped during: $install_phase (exit $status). Existing secrets and volumes were retained."
  if (( stop_writers_on_failure )); then
    if lifecycle stop --timeout 90 app worker ${mail_writer:+mailserver} >/dev/null; then
      log "This project's app and worker are stopped. Resolve the error before starting writers; the database and persistent volumes were retained."
    else
      log "ERROR: Unable to stop this project's app and worker. Check Docker access and stop these writers before allowing traffic or further recovery."
    fi
    [[ -z "$safety_backup" ]] || log "Pre-upgrade encrypted recovery point: $safety_backup"
  fi
  if [[ -n "$release_dir" && -f "$release_dir/scripts/doctor.sh" ]]; then
    log "Read-only diagnosis: sudo bash $release_dir/scripts/doctor.sh"
    lifecycle ps --timeout 15 >&2 || true
  fi
  exit "$status"
}
trap installation_finished EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
usage() {
  cat <<'HELP'
Usage (inside the extracted project):
  sudo bash scripts/install-ubuntu.sh --domain idealmako.ir --email admin@example.com
  sudo bash scripts/install-ubuntu.sh --domain 127.0.0.1 --http --http-port 8080 --without-antivirus

Options:
  --app-dir /var/www/idealmakoo   Isolated installation directory
  --env-file /absolute/.env      Protected settings; blank internal secrets are generated only on first install
  --project-name idealmakoo      Unique Docker Compose project name
  --admin-email EMAIL            Initial administrator (default admin@DOMAIN)
  --http                        Explicit HTTP mode for localhost/IP test environments
  --http-port N --https-port N   Published proxy ports (default 80 / 443)
  --bind-ip IP                  Proxy bind address (default 0.0.0.0)
  --with-mail-server             Install domain SMTP/IMAP/DKIM (requires prepared public DNS)
  --without-mail-server          Use external SMTP; preserve retained mailbox data
  --mail-mode local|external|off  Explicit advanced selection; default external, upgrades preserve mode
  --without-antivirus           Do not start local ClamAV; non-image files remain quarantined
  --skip-resource-check         Operator explicitly accepts a smaller host
  --without-backup-timer        Do not install the daily backup timer
  --najva-worker-file PATH      Explicit official najva-messaging-sw.js, mounted read-only

Requirements: Ubuntu 22.04/24.04 LTS, root, public DNS + TCP80/443 for TLS,
at least 8 GiB RAM with local mail; app-only: 6 GiB with antivirus, 4 GiB without.
At least 15 GiB free disk, plus capacity for mail, media and backups.
Existing .env, database volumes, unrelated projects, SSH and firewall rules are preserved.
HELP
}
while (( $# )); do
  case "$1" in
    --domain) domain="${2:?Missing domain}"; shift 2 ;;
    --email) email="${2:?Missing email}"; shift 2 ;;
    --admin-email) admin_email="${2:?Missing administrator email}"; shift 2 ;;
    --app-dir) app_dir="${2:?Missing application directory}"; app_dir_set=1; shift 2 ;;
    --env-file) input_env="${2:?Missing environment filename}"; shift 2 ;;
    --project-name) project_name="${2:?Missing project name}"; project_set=1; shift 2 ;;
    --http) http=1; shift ;;
    --http-port) http_port="${2:?Missing HTTP port}"; http_port_set=1; shift 2 ;;
    --https-port) https_port="${2:?Missing HTTPS port}"; https_port_set=1; shift 2 ;;
    --bind-ip) bind_ip="${2:?Missing bind address}"; bind_set=1; shift 2 ;;
    --mail-mode) mail_mode="${2:?Missing mail mode}"; mail_mode_explicit=1; shift 2 ;;
    --with-mail-server) mail_mode=local; mail_mode_explicit=1; shift ;;
    --without-mail-server) mail_mode=external; mail_mode_explicit=1; shift ;;
    --without-antivirus) antivirus=0; antivirus_set=1; shift ;;
    --skip-resource-check) resource_check=0; shift ;;
    --without-backup-timer) backup_timer=0; shift ;;
    --najva-worker-file) najva_worker_file="${2:?Missing official worker filename}"; shift 2 ;;
    --recover-payload) recovery_payload="${2:?Missing authenticated recovery payload}"; shift 2 ;;
    --recover-identity) recovery_identity="${2:?Missing external recovery identity}"; shift 2 ;;
    --recover-latest-ledger) recovery_latest_ledger="${2:?Missing latest independent ledger}"; shift 2 ;;
    --recover-activate-outbound) recovery_activate_outbound=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
if [[ -z "$recovery_payload" ]]; then
  [[ -z "$recovery_identity" && -z "$recovery_latest_ledger" && "$recovery_activate_outbound" == 0 ]] || die "Recovery options require the authenticated new-host recovery wrapper."
fi
[[ "$EUID" == 0 ]] || die "Run the installer with sudo."
[[ -f /etc/os-release ]] || die "Cannot identify the operating system."
# shellcheck source=/dev/null
source /etc/os-release
[[ "$ID" == ubuntu && ( "$VERSION_ID" == 22.04 || "$VERSION_ID" == 24.04 ) ]] || die "Supported hosts: Ubuntu 22.04 and 24.04 LTS."
[[ -d /run/systemd/system ]] || die "The installer requires an Ubuntu host with systemd."
if ! command -v python3 >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o APT::Update::Error-Mode=any update
  apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends python3 ca-certificates
fi
if [[ -z "$input_env" && -f "$SOURCE_ROOT/.env" ]]; then input_env="$SOURCE_ROOT/.env"; fi
if [[ -n "$input_env" ]]; then
  [[ -f "$input_env" ]] || die "The supplied --env-file does not exist."
  input_env="$(realpath "$input_env")"
  (( (8#$(stat -c '%a' "$input_env") & 8#077) == 0 )) || die "Protect --env-file with chmod 600 before installation."
  input_value() { python3 "$SOURCE_ROOT/deploy/env-file.py" get "$input_env" "$1" "${2:-}"; }
  (( app_dir_set )) || app_dir="$(input_value INSTALL_ROOT "$app_dir")"
  (( project_set )) || project_name="$(input_value COMPOSE_PROJECT_NAME "$project_name")"
  if [[ -z "$domain" ]]; then
    configured_address="$(input_value SITE_ADDRESS)"
    [[ "$configured_address" != http://* ]] || http=1
    domain="${configured_address#http://}"; domain="${domain#https://}"
  fi
  (( mail_mode_explicit )) || mail_mode="$(input_value MAIL_SERVER_MODE auto)"
  email="${email:-$(input_value ACME_EMAIL)}"
  admin_email="${admin_email:-$(input_value BOOTSTRAP_ADMIN_EMAIL)}"
  (( http_port_set )) || http_port="$(input_value HTTP_PORT 80)"
  (( https_port_set )) || https_port="$(input_value HTTPS_PORT 443)"
  (( bind_set )) || bind_ip="$(input_value BIND_IP 0.0.0.0)"
  # A minimal env file must keep the documented secure first-install default.
  # Only an explicitly empty/different profile or --without-antivirus opts out.
  if (( antivirus_set == 0 )) && [[ ",$(input_value COMPOSE_PROFILES antivirus)," != *,antivirus,* ]]; then antivirus=0; fi
fi
[[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "Provide a domain or IPv4 address without a scheme, path or port."
[[ "$project_name" =~ ^[a-z0-9][a-z0-9_-]{0,39}$ ]] || die "Invalid project name."
[[ "$app_dir" =~ ^/[A-Za-z0-9_./-]+$ ]] || die "Use an absolute application directory without spaces."
app_dir="$(realpath -m "$app_dir")"
if (( backup_timer )); then
  # ProtectHome/PrivateTmp hide these trees from the daily service, including aliases.
  case "$app_dir" in
    /home|/home/*|/root|/root/*|/run/user|/run/user/*|/tmp|/tmp/*|/var/tmp|/var/tmp/*)
      die "The daily backup timer cannot access home or temporary application roots (/home, /root, /run/user, /tmp, /var/tmp). Choose a dedicated directory under /var/www or /opt, or pass --without-backup-timer to skip timer setup and run backups manually."
      ;;
  esac
fi
case "$app_dir" in /|/etc|/usr|/var|/var/www|/opt|/home|/root|/tmp) die "Choose a dedicated application subdirectory." ;; esac
if [[ -n "$recovery_payload" ]]; then
  [[ -n "$recovery_identity" && -f "$recovery_payload/source.tar" && -f "$recovery_payload/database-inventory.json" ]] || die "Complete authenticated recovery material is required."
  python3 "$SOURCE_ROOT/deploy/backup-archive.py" inventory "$recovery_payload" "$recovery_identity" >/dev/null
  if [[ -e "$app_dir" ]]; then
    [[ -d "$app_dir" && -z "$(find "$app_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]] || die "New-host recovery refuses any existing installation data."
  fi
  [[ -z "$najva_worker_file" ]] || die "Restore the archived integration files before selecting a replacement Najva worker."
fi
for port in "$http_port" "$https_port"; do
  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then die "Invalid port."; fi
done
http_port=$((10#$http_port))
https_port=$((10#$https_port))
[[ "$http_port" != "$https_port" ]] || die "HTTP and HTTPS ports must differ."
[[ "$bind_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--bind-ip must be an IPv4 address."
if (( http == 0 )); then
  [[ "$domain" != localhost && ! "$domain" =~ ^[0-9.]+$ ]] || die "Use --http for localhost/IP. Public TLS needs a DNS hostname."
  [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Provide a valid --email for certificate registration."
fi
admin_email="${admin_email:-admin@$domain}"
[[ "$domain" != localhost && ! "$domain" =~ ^[0-9.]+$ ]] || admin_email="${admin_email/admin@$domain/admin@localhost.invalid}"
[[ "$admin_email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Provide a valid --admin-email."
[[ -f "$SOURCE_ROOT/Dockerfile" && -f "$SOURCE_ROOT/package-lock.json" ]] || die "Run from a complete release."
if [[ -e "$app_dir/current" && ! -L "$app_dir/current" ]]; then die "$app_dir/current exists and is not this installer's symlink."; fi
if [[ -L "$app_dir/current" ]]; then
  case "$(realpath "$app_dir/current")" in "$app_dir"/releases/*) ;; *) die "The existing current symlink points outside this installation." ;; esac
fi
if [[ -e "$app_dir/shared/.pending-restore" || -L "$app_dir/shared/.pending-restore" ]]; then
  die "This installation has a pending same-host restore. Keep writers stopped and finish its matching restore.sh --resume before installing another release."
fi
if (( resource_check )); then
  ram_mb="$(awk '/MemTotal:/ {print int($2/1024)}' /proc/meminfo)"
  minimum_ram=3900; (( antivirus == 0 )) || minimum_ram=5800
  (( ram_mb >= minimum_ram )) || die "RAM is ${ram_mb} MiB. Need approximately $minimum_ram MiB; --without-antivirus needs 4 GiB, --skip-resource-check is an explicit operator override."
  space_base="$app_dir"
  while [[ ! -d "$space_base" ]]; do space_base="$(dirname "$space_base")"; done
  free_mb="$(df -Pm "$space_base" | awk 'NR==2 {print $4}')"
  (( free_mb >= 15000 )) || die "At least 15 GiB free disk is required for build, database and the initial backup."
fi
# The first upgrade from an older version must never silently replace external SMTP.
if [[ -f "$app_dir/shared/.env" && "$mail_mode_explicit" == 0 ]]; then
  mail_mode="$(python3 "$SOURCE_ROOT/deploy/env-file.py" get "$app_dir/shared/.env" MAIL_SERVER_MODE external)"
  [[ "$mail_mode" != auto && -n "$mail_mode" ]] || mail_mode=external
elif [[ "$mail_mode" == auto || -z "$mail_mode" ]]; then
  if [[ -n "$recovery_payload" ]]; then
    # A historical complete archive with no mode predates managed mail. Its
    # original external SMTP must not be replaced during new-host recovery.
    mail_mode=external
  else mail_mode=external; fi
fi
[[ "$mail_mode" == local || "$mail_mode" == external || "$mail_mode" == off ]] || die 'Invalid mail mode.'
[[ "$mail_mode" != local || "$http" == 0 ]] || die 'Managed domain mail requires HTTPS and public DNS; use --mail-mode external or off for a local test.'
if (( resource_check )) && [[ "$mail_mode" == local ]]; then
  (( ram_mb >= 7800 )) || die 'Managed mail plus this application requires approximately 8 GiB RAM; use an external SMTP provider on a smaller host or explicitly review the resource override.'
fi
network_step() { python3 "$SOURCE_ROOT/deploy/network-steps.py" --attempts 3 --timeout 900 "$@"; }
install_phase='operating-system prerequisites'
log "Installing operating-system prerequisites from configured Ubuntu repositories."
export DEBIAN_FRONTEND=noninteractive
network_step apt-update -- apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o APT::Update::Error-Mode=any update
network_step apt-install -- apt-get -o DPkg::Lock::Timeout=180 -o Acquire::Retries=1 install -y --no-install-recommends ca-certificates curl gnupg openssl age rsync python3 util-linux iproute2 dnsutils
if ! command -v docker >/dev/null 2>&1; then
  conflicts=()
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" == 'install ok installed' ]]; then conflicts+=("$package"); fi
  done
  (( ${#conflicts[@]} == 0 )) || die "Existing container packages require operator review before official Docker installation: ${conflicts[*]}. No packages were removed."
  install -d -m 0755 /etc/apt/keyrings
  key_tmp="$(mktemp)"
  network_step docker-key -- curl --fail --silent --show-error --location --max-time 60 --connect-timeout 15 --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg -o "$key_tmp"
  fingerprint="$(gpg --show-keys --with-colons "$key_tmp" 2>/dev/null | awk -F: '$1=="fpr" {print $10; exit}')"
  [[ "$fingerprint" == 9DC858229FC7DD38854AE2D88D81803C0EBFCD88 ]] || { rm -f "$key_tmp"; die "Docker repository signing key fingerprint did not match the reviewed key."; }
  install -m 0644 "$key_tmp" /etc/apt/keyrings/idealmakoo-docker.asc
  rm -f "$key_tmp"
  source_tmp="$(mktemp)"
  cat > "$source_tmp" <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/idealmakoo-docker.asc
EOF
  repo_file=/etc/apt/sources.list.d/idealmakoo-docker.sources
  if [[ -e "$repo_file" ]] && ! cmp -s "$repo_file" "$source_tmp"; then rm -f "$source_tmp"; die "Existing $repo_file differs; no repository definition was overwritten."; fi
  install -m 0644 "$source_tmp" "$repo_file"
  rm -f "$source_tmp"
  network_step apt-update -- apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o APT::Update::Error-Mode=any update
  network_step apt-install -- apt-get -o DPkg::Lock::Timeout=180 -o Acquire::Retries=1 install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker info >/dev/null 2>&1 || systemctl enable --now docker
docker info >/dev/null
if ! docker compose version >/dev/null 2>&1; then
  if [[ "$(dpkg-query -W -f='${Status}' docker-ce-cli 2>/dev/null || true)" == 'install ok installed' ]]; then
    network_step apt-install -- apt-get -o DPkg::Lock::Timeout=180 -o Acquire::Retries=1 install -y --no-install-recommends docker-compose-plugin docker-buildx-plugin
  elif [[ "$(dpkg-query -W -f='${Status}' docker.io 2>/dev/null || true)" == 'install ok installed' ]]; then
    network_step apt-install -- apt-get -o DPkg::Lock::Timeout=180 -o Acquire::Retries=1 install -y --no-install-recommends docker-compose-v2 docker-buildx
  else
    die "This existing Docker installation has no Compose plugin and is not managed by a recognized Ubuntu/Docker package. Install its compatible Compose v2 and Buildx plugins, then rerun; no engine or container was replaced."
  fi
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is still unavailable; check the package installation error."
compose_version="$(docker compose version --short | sed 's/^v//')"
[[ "$(printf '%s\n' 2.24.0 "$compose_version" | sort -V | head -n1)" == 2.24.0 ]] || die "Docker Compose 2.24 or newer is required."
if [[ "$mail_mode" == local ]]; then
  [[ "$(printf '%s\n' 2.40.0 "$compose_version" | sort -V | head -n1)" == 2.40.0 ]] || die 'Managed mail requires Compose2.40+ for an isolated certificate subdirectory mount; external mail remains available.'
  engine_version="$(docker version --format '{{.Server.Version}}')"
  [[ "$(printf '%s\n' 26.0.0 "$engine_version" | sort -V | head -n1)" == 26.0.0 ]] || die 'Managed mail requires Docker Engine26+; review an engine upgrade deliberately without stopping unrelated projects.'
fi
if [[ -n "$recovery_payload" ]]; then
  [[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project_name")" ]] || die "New-host recovery requires a Compose project with no existing containers."
  [[ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$project_name")" ]] || die "New-host recovery will not reuse existing project volumes."
  for volume in database storage next-cache caddy-data caddy-config clamav-signatures; do
    if docker volume inspect "${project_name}_${volume}" >/dev/null 2>&1; then die "An existing target volume was found; use a fresh --project-name."; fi
  done
fi
for container in $(docker ps -aq --filter "label=com.docker.compose.project=$project_name"); do
  working_dir="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$container")"
  case "$working_dir" in "$app_dir"/releases/*) ;; *) die "Compose project $project_name already belongs to $working_dir. Use a unique --project-name." ;; esac
done
own_proxy="$(docker ps -q --filter "label=com.docker.compose.project=$project_name" --filter 'label=com.docker.compose.service=proxy')"
if [[ -z "$own_proxy" ]]; then
  for port in "$http_port" "$https_port"; do
    [[ -z "$(ss -H -lnt "sport = :$port")" ]] || die "TCP port $port is already occupied. This installer will not stop another project."
  done
fi
install -d -m 0750 "$app_dir" "$app_dir/releases"
install -d -m 0700 "$app_dir/shared" "$app_dir/shared/backups"
install_phase='protected environment and persistent directories'
export IDEALMAKOO_ENV_FILE="$app_dir/shared/.env"
ENV_FILE="$IDEALMAKOO_ENV_FILE"
site_address="$domain"; site_url="https://$domain"
if (( http )); then site_address="http://$domain"; site_url="http://$domain"; [[ "$http_port" == 80 ]] || site_url="$site_url:$http_port";
else [[ "$https_port" == 443 ]] || site_url="$site_url:$https_port"; fi
if [[ ! -f "$ENV_FILE" ]]; then
  profiles=""; (( antivirus == 0 )) || profiles=antivirus
  environment_command=initialize; administrator_selection=("BOOTSTRAP_ADMIN_EMAIL=$admin_email")
  if [[ -n "$recovery_payload" ]]; then environment_command=recover; administrator_selection=(); fi
  python3 "$SOURCE_ROOT/deploy/bootstrap-environment.py" "$environment_command" "$ENV_FILE" "$SOURCE_ROOT/.env.example" "$input_env" \
    "COMPOSE_PROJECT_NAME=$project_name" "COMPOSE_PROFILES=$profiles" "INSTALL_ROOT=$app_dir" "MAIL_SERVER_MODE=$mail_mode" "MAIL_SERVER_ENABLED=$([[ "$mail_mode" == local ]] && printf true || printf false)" "MAIL_DATA_DIR=$app_dir/mail-server" \
    "SITE_URL=$site_url" "SITE_ADDRESS=$site_address" "ACME_EMAIL=${email:-admin@localhost.invalid}" \
    "${administrator_selection[@]}" "HTTP_PORT=$http_port" "HTTPS_PORT=$https_port" "BIND_IP=$bind_ip" \
    "PRIVACY_LEDGER_HOST_DIR=/var/lib/idealmakoo-privacy/$project_name" "INTEGRATIONS_HOST_DIR=$app_dir/integrations"
else
  log "Preserving the existing .env, encryption keys and bootstrap configuration."
  python3 "$SOURCE_ROOT/deploy/bootstrap-environment.py" validate "$ENV_FILE"
  stored_mail_mode="$(python3 "$SOURCE_ROOT/deploy/env-file.py" get "$ENV_FILE" MAIL_SERVER_MODE external)"
  if (( mail_mode_explicit )) || [[ "$stored_mail_mode" == auto || -z "$stored_mail_mode" ]]; then
    python3 "$SOURCE_ROOT/deploy/env-file.py" set "$ENV_FILE" MAIL_SERVER_MODE "$mail_mode"
    python3 "$SOURCE_ROOT/deploy/env-file.py" set "$ENV_FILE" MAIL_SERVER_ENABLED "$([[ "$mail_mode" == local ]] && printf true || printf false)"
  fi
fi
python3 "$SOURCE_ROOT/deploy/env-file.py" defaults "$ENV_FILE" "$SOURCE_ROOT/.env.example" \
  "PRIVACY_LEDGER_HOST_DIR=/var/lib/idealmakoo-privacy/$project_name" \
  "INTEGRATIONS_HOST_DIR=$app_dir/integrations" "MAIL_SERVER_MODE=$mail_mode"
directory_args=("$ENV_FILE" "$app_dir")
[[ -z "$najva_worker_file" ]] || directory_args+=("$najva_worker_file")
python3 "$SOURCE_ROOT/deploy/runtime-directories.py" "${directory_args[@]}"
if [[ -n "$recovery_payload" ]]; then
  host_restore_args=("$recovery_payload" "$ENV_FILE")
  [[ -z "$recovery_latest_ledger" ]] || host_restore_args+=("$recovery_latest_ledger")
  python3 "$SOURCE_ROOT/deploy/restore-host-files.py" "${host_restore_args[@]}"
  restored_database_image="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["databaseImage"])' "$recovery_payload/deployment.json")"
  [[ "$restored_database_image" =~ ^[a-zA-Z0-9._:/@-]+$ ]] || die "Invalid authenticated database image reference."
  python3 "$SOURCE_ROOT/deploy/env-file.py" set "$ENV_FILE" POSTGRES_IMAGE "$restored_database_image"
  if (( recovery_activate_outbound == 0 )); then
    python3 "$SOURCE_ROOT/deploy/env-file.py" set "$ENV_FILE" NOTIFICATIONS_MODE disabled
    python3 "$SOURCE_ROOT/deploy/env-file.py" set "$ENV_FILE" CRM_CAMPAIGNS_ENABLED false
    log "Restored external notifications and campaigns are paused in .env. Review pending deliveries before activating them."
  fi
fi
[[ "$(env_get COMPOSE_PROJECT_NAME idealmakoo)" == "$project_name" ]] || die "Existing environment uses another project name; rerun with that --project-name."
[[ "$(env_get SITE_URL)" == "$site_url" ]] || die "Existing SITE_URL differs. Review .env deliberately before changing domain, protocol or ports."
if [[ -n "$recovery_identity" ]]; then
  [[ ! -e "$app_dir/shared/backup-identity.txt" ]] || die "An existing recovery identity will not be overwritten."
  install -m 0600 "$recovery_identity" "$app_dir/shared/backup-identity.txt"
elif [[ ! -f "$app_dir/shared/backup-identity.txt" ]]; then
  age-keygen -o "$app_dir/shared/backup-identity.txt" 2>/dev/null
  chmod 0600 "$app_dir/shared/backup-identity.txt"
fi
require_environment; acquire_ops_lock
mail_writer=""; [[ "$(env_get MAIL_SERVER_MODE external)" != local ]] || mail_writer=1
retained_mail_dir="$(env_get MAIL_DATA_DIR)"; retained_mail_dir="${retained_mail_dir:-$app_dir/mail-server}"
[[ ! -e "$retained_mail_dir/.idealmakoo-mail.json" ]] || mail_writer=1
pending_restore assert-clear
install_phase='managed mail keys, persistent storage and DNS readiness'
if [[ -n "$recovery_payload" && -f "$recovery_payload/mail-manifest.json" && "$(env_get MAIL_SERVER_MODE external)" != local ]]; then
  python3 "$SOURCE_ROOT/deploy/mail-data.py" restore --env-file "$ENV_FILE" --payload "$recovery_payload" --fresh
fi
if [[ "$(env_get MAIL_SERVER_MODE external)" == local ]]; then
  if [[ -n "$recovery_payload" && -f "$recovery_payload/mail-manifest.json" ]]; then
    python3 "$SOURCE_ROOT/deploy/mail-data.py" restore --env-file "$ENV_FILE" --payload "$recovery_payload" --fresh
  else
    python3 "$SOURCE_ROOT/deploy/mail-config.py" prepare --env-file "$ENV_FILE"
  fi
  log "Public mail DNS records: $(env_get MAIL_DATA_DIR)/dns-records.json. Add these at your DNS provider, then rerun if this check stops."
  python3 "$SOURCE_ROOT/deploy/mail-diagnostics.py" --env-file "$ENV_FILE" --dns-only
  existing_mail="$(docker ps -aq --filter "label=com.docker.compose.project=$project_name" --filter 'label=com.docker.compose.service=mailserver')"
  if [[ -z "$existing_mail" ]]; then
    for port in 25 465 587 993; do [[ -z "$(ss -H -lnt "sport = :$port")" ]] || die "Mail TCP port $port belongs to another service; no service was stopped."; done
  fi
fi
release="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
release_dir="$app_dir/releases/$release"
install -d -m 0750 "$release_dir"
rsync -a --safe-links --exclude='.git/' --exclude='node_modules/' --exclude='.next/' --exclude='out/' \
  --include='.env.example' --exclude='.env' --exclude='.env.*' --exclude='.release.env' \
  --exclude='storage/' --exclude='privacy-ledger/' --exclude='integrations/' --exclude='backups/' --exclude='shared/' --exclude='releases/' \
  --exclude='tmp/' --exclude='qa-artifacts/' --exclude='deliverables/' --exclude='coverage/' \
  --exclude='current' --exclude='previous' --exclude='test-results/' --exclude='playwright-report/' \
  --exclude='*.age' --exclude='*.dump' --exclude='*.log' "$SOURCE_ROOT/" "$release_dir/"
# Recovered source is extracted privately. This script is mounted as a single
# read-only file into PostgreSQL running as uid999 and contains no credentials.
chmod 0644 "$release_dir/deploy/postgres/init-roles.sh"
ln -s "$ENV_FILE" "$release_dir/.env"
cat > "$release_dir/.release.env" <<EOF
APP_IMAGE=$project_name-app:$release
PROXY_IMAGE=$project_name-proxy:$release
CLAMAV_RUNTIME_IMAGE=$project_name-clamav:$release
RELEASE_SHA=$release
EOF
previous=""
[[ ! -L "$app_dir/current" ]] || previous="$(realpath "$app_dir/current")"
source "$release_dir/deploy/lib.sh"
require_environment
log "Building release $release. Existing application stays available during the build."
install_phase='application and proxy image build'
build_services=(app proxy)
[[ ",$(env_get COMPOSE_PROFILES)," != *,antivirus,* ]] || build_services+=(clamav)
python3 "$PROJECT_ROOT/deploy/network-steps.py" --attempts 2 --timeout 3600 image-build -- python3 "$PROJECT_ROOT/deploy/build-images.py" "$PROJECT_ROOT" "$ENV_FILE" "${build_services[@]}"
network_mode="$(env_get INSTALL_NETWORK_MODE online)"
if [[ "$network_mode" == local-images ]]; then
  docker image inspect "$(env_get POSTGRES_IMAGE pgvector/pgvector:pg16)" >/dev/null || die 'The exact PostgreSQL image must be loaded before local-images installation.'
else
  python3 "$PROJECT_ROOT/deploy/network-steps.py" --attempts 3 --timeout 900 image-pull -- python3 "$PROJECT_ROOT/deploy/compose.py" "$PROJECT_ROOT" "$ENV_FILE" pull db
fi
if [[ "$(env_get MAIL_SERVER_MODE external)" == local ]]; then
  if [[ "$network_mode" == local-images ]]; then
    docker image inspect "$(env_get MAIL_SERVER_IMAGE)" >/dev/null || die 'The pinned mail image must be loaded before local-images installation.'
  else
    python3 "$PROJECT_ROOT/deploy/network-steps.py" --attempts 3 --timeout 900 image-pull -- python3 "$PROJECT_ROOT/deploy/compose.py" "$PROJECT_ROOT" "$ENV_FILE" pull mailserver
  fi
  python3 "$PROJECT_ROOT/deploy/mail-config.py" caddy --env-file "$ENV_FILE" | dc --profile operations run-existing --rm --no-deps --pull never -T --entrypoint /bin/sh proxy-data-tool -eu -c 'mkdir -p /data/idealmakoo-extra; cat > /data/idealmakoo-extra/mail.caddy; chmod 600 /data/idealmakoo-extra/mail.caddy'
fi
if [[ -n "$(env_get NAJVA_WORKER_FILE)" ]]; then
  [[ "$(env_get NAJVA_WORKER_FILE)" == /app/integrations/najva-messaging-sw.js ]] || die "Use the managed --najva-worker-file path."
  dc run-existing --rm --no-deps --pull never -T app node --check /app/integrations/najva-messaging-sw.js
fi
if [[ -n "$previous" ]]; then
  install_phase='pre-upgrade encrypted backup'
  log "Saving the previous release's database, files and encryption keys before migration."
  # The reviewed backup code observes the active container's release, image and
  # source itself. Its exact-ID resumption must also apply when upgrading a
  # historical release whose own backup script predates staged startup.
  safety_backup="$(bash "$release_dir/scripts/backup.sh")"
  stop_writers_on_failure=1
  lifecycle stop --timeout 90 app worker ${mail_writer:+mailserver} >/dev/null
fi
# The project and its container working directories were verified before the
# build. From schema preparation through final readiness, a failure must stop
# even writers which have already been started for their health checks.
stop_writers_on_failure=1
install_phase='database startup and schema preparation'
dc up -d --no-deps --wait --wait-timeout 180 db
if [[ -n "$recovery_payload" ]]; then
  # A recovered site keeps its exact database snapshot; seed/provisioning is not
  # rerun and cannot reset content, credentials or roles during disaster recovery.
  # shellcheck source=deploy/recovery.sh
  source "$PROJECT_ROOT/deploy/recovery.sh"
  privacy_cli verify-anchor --anchor - < "$recovery_payload/privacy-anchor.json" >/dev/null
  restore_empty_database "$recovery_payload" "$(database_name)" 0
  restore_media_payload "$recovery_payload" 0
  for directory in data config; do
    dc --profile operations run-existing --rm --no-deps --pull never -T proxy-data-tool \
      -C "/$directory" -xf - < "$recovery_payload/caddy-$directory.tar"
    dc --profile operations run-existing --rm --no-deps --pull never -T proxy-data-tool \
      -C "/$directory" -cf - . | python3 "$PROJECT_ROOT/deploy/backup-archive.py" verify-storage-stream "$recovery_payload/caddy-$directory.tar" >&2
  done
  privacy_cli replay --anchor - < "$recovery_payload/privacy-anchor.json" >/dev/null
  # New-host recovery has no current-access snapshot; all helper arguments are optional.
  # shellcheck disable=SC2119
  apply_restore_security
  privacy_cli ready
else
  dc up --no-deps --force-recreate --abort-on-container-exit --exit-code-from migrate migrate
fi
if [[ ",$(env_get COMPOSE_PROFILES)," == *,antivirus,* ]]; then
  install_phase='antivirus startup and initial signatures'
  dc up -d --no-deps clamav
fi
install_phase='application, worker, scanner and public endpoint readiness'
lifecycle up --timeout 1200 app worker proxy
if [[ "$(env_get MAIL_SERVER_MODE external)" == local ]]; then
  install_phase="domain mail TLS and authenticated SMTP readiness"
  bash "$PROJECT_ROOT/scripts/mail-certificate-wait.sh"
  lifecycle up --timeout 600 mailserver
  python3 "$PROJECT_ROOT/deploy/mail-diagnostics.py" --env-file "$ENV_FILE"
fi
bash "$release_dir/scripts/check-health.sh" 240
if [[ -n "$previous" ]]; then
  ln -s "$previous" "$app_dir/previous.next"
  mv -Tf "$app_dir/previous.next" "$app_dir/previous"
fi
ln -s "$release_dir" "$app_dir/current.next"
mv -Tf "$app_dir/current.next" "$app_dir/current"
if (( backup_timer )); then
  install_phase='daily backup timer'
  unit="idealmakoo-$project_name-backup"
  for suffix in service timer; do
    file="/etc/systemd/system/$unit.$suffix"
    if [[ -e "$file" ]] && ! grep -Fqx "# Managed for $app_dir" "$file"; then die "Existing unrelated systemd unit $file was not overwritten."; fi
  done
  cat > "/etc/systemd/system/$unit.service" <<EOF
# Managed for $app_dir
[Unit]
Description=Encrypted coordinated backup for $project_name
Requires=docker.service
After=docker.service
[Service]
Type=oneshot
UMask=0077
WorkingDirectory=$app_dir/current
ExecStart=/usr/bin/bash $app_dir/current/scripts/backup.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$app_dir/shared
EOF
  cat > "/etc/systemd/system/$unit.timer" <<EOF
# Managed for $app_dir
[Unit]
Description=Daily backup for $project_name
[Timer]
OnCalendar=*-*-* 03:30:00 Asia/Tehran
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
EOF
  chmod 0644 "/etc/systemd/system/$unit.service" "/etc/systemd/system/$unit.timer"
  systemctl daemon-reload
  systemctl enable --now "$unit.timer"
fi
if [[ "$(env_get MAIL_SERVER_MODE external)" == local ]]; then bash "$release_dir/scripts/mail-certificate-timer.sh" "$app_dir" "$project_name"; fi
install_phase='initial complete encrypted backup and final readiness'
bash "$release_dir/scripts/backup.sh" >/dev/null
bash "$release_dir/scripts/check-health.sh" 240
stop_writers_on_failure=0
log "Release is running: $site_url"
if [[ -n "$recovery_payload" ]]; then
  log "Existing account passwords and enrolled MFA were restored; no replacement bootstrap password was generated."
else
  log "Administrator: $(env_get BOOTSTRAP_ADMIN_EMAIL). Retrieve BOOTSTRAP_ADMIN_PASSWORD privately from $ENV_FILE, then change it and enroll MFA."
fi
log "Current release: $app_dir/current"
log "Copy $app_dir/shared/backup-identity.txt to a separate safe location; encrypted backups require this key."
log "Complete backups include a disaster-recovery copy of the privacy ledger. Existing-site restore always preserves the current independent ledger at $(env_get PRIVACY_LEDGER_HOST_DIR). Keep its latest protected off-host copy for erasures after the selected backup."

