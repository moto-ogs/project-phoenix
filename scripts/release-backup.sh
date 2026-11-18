#!/usr/bin/env bash
# Complete release snapshots. Run from the environment's Compose directory.
# Secrets remain in owner-only files; never source snapshot metadata as shell.
set -euo pipefail
umask 077

fail() { echo "ERROR: $*" >&2; exit 1; }
compose() { docker compose "$@"; }
required_files=(database.dump roles.sql uploads.tar.gz .env compose.yml images.tsv deploy-state environment created-at uploads-volume)
# Copies the S3 upload bucket; hosts need no rclone of their own.
rclone_image=rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5
bucket_pattern='^bucket:([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$'

digest() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi
}

environment() {
  case "${DEPLOY_DIR:-}" in staging|production|demo) ;; *) fail 'DEPLOY_DIR must be staging, production or demo';; esac
}

volume() {
  local container mounted
  container=$(compose ps -a -q server)
  [ -n "$container" ] || fail 'Serving container is missing; cannot identify the uploads volume'
  mounted=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/public/uploads"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$container")
  [ -n "$mounted" ] || fail 'Server uploads mount is not a named volume'
  docker volume inspect "$mounted" >/dev/null
  printf '%s\n' "$mounted"
}

# The environment the serving container ran with, the one that wrote the
# uploads. Read once in this shell: a failed inspect inside a command
# substitution would pass for an empty setting, and so for local mode.
server_env=''
read_server_env() {
  local container
  container=$(compose ps -a -q server)
  [ -n "$container" ] || fail 'Serving container is missing; cannot read its upload settings'
  server_env=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container") &&
    [ -n "$server_env" ] || fail 'Cannot read the upload settings of the serving container'
}

# One value of that environment, without printing the rest; never in argv.
server_setting() {
  local line
  while IFS= read -r line; do
    if [[ "$line" == "$1="* ]]; then printf '%s\n' "${line#*=}"; return 0; fi
  done <<< "$server_env"
}

# local (empty included) uses the volume, s3 the bucket; as the app decides.
upload_store() {
  read_server_env
  case "$(server_setting UPLOADS_BACKEND)" in
    ''|local) upload_kind=local;; s3) upload_kind=s3;;
    *) fail 'Unknown UPLOADS_BACKEND on the server';;
  esac
}

# Loads the server's bucket settings into this shell, not into its output.
load_bucket() {
  upload_endpoint=$(server_setting UPLOADS_S3_ENDPOINT)
  upload_region=$(server_setting UPLOADS_S3_REGION)
  upload_bucket=$(server_setting UPLOADS_S3_BUCKET)
  upload_access_key=$(server_setting UPLOADS_S3_ACCESS_KEY)
  upload_secret_key=$(server_setting UPLOADS_S3_SECRET_KEY)
  [ -n "$upload_endpoint" ] && [ -n "$upload_region" ] && [ -n "$upload_bucket" ] &&
    [ -n "$upload_access_key" ] && [ -n "$upload_secret_key" ] ||
    fail 'Server has UPLOADS_BACKEND=s3 without every UPLOADS_S3_* value'
  [[ "bucket:$upload_bucket" =~ $bucket_pattern ]] || fail 'Invalid UPLOADS_S3_BUCKET on the server'
}

# rclone against the loaded bucket, with /tree bound to the given directory.
# Diagnostics name objects and stay off the deployment log.
bucket_rclone() {
  local tree=$1; shift
  RCLONE_CONFIG_UPLOADS_ENDPOINT=$upload_endpoint RCLONE_CONFIG_UPLOADS_REGION=$upload_region \
  RCLONE_CONFIG_UPLOADS_ACCESS_KEY_ID=$upload_access_key RCLONE_CONFIG_UPLOADS_SECRET_ACCESS_KEY=$upload_secret_key \
    docker run --rm --network host --user "$(id -u):$(id -g)" --mount "type=bind,src=$tree,dst=/tree" \
      -e RCLONE_CONFIG_UPLOADS_TYPE=s3 -e RCLONE_CONFIG_UPLOADS_PROVIDER=Other \
      -e RCLONE_CONFIG_UPLOADS_ENV_AUTH=false -e RCLONE_CONFIG_UPLOADS_ACL=private \
      -e RCLONE_CONFIG_UPLOADS_NO_CHECK_BUCKET=true -e RCLONE_CONFIG_UPLOADS_ENDPOINT \
      -e RCLONE_CONFIG_UPLOADS_REGION -e RCLONE_CONFIG_UPLOADS_ACCESS_KEY_ID \
      -e RCLONE_CONFIG_UPLOADS_SECRET_ACCESS_KEY "$rclone_image" \
      --config /dev/null --quiet --retries 1 --no-unicode-normalization "$@" >/dev/null 2>&1
}

# Everything that writes to the database or uploads: server and frontend
# everywhere, plus the demo stack's demo-runtime. Read from the current Compose
# file, so staging, production and older demo snapshots never name the sidecar.
app_services() {
  local listed
  listed=$(compose config --services)
  if grep -qx demo-runtime <<< "$listed"; then echo 'server frontend demo-runtime'; else echo 'server frontend'; fi
}

ensure_stopped() {
  local service container services
  services=$(app_services)
  for service in $services; do
    container=$(compose ps -a -q "$service")
    # The sidecar has no container until its first deployment has started it.
    [ -n "$container" ] || [ "$service" != demo-runtime ] || continue
    [ -n "$container" ] || fail "Missing $service container"
    [ "$(docker inspect --format '{{.State.Running}}' "$container")" = false ] || fail "$service is still running"
  done
}

# A rebuild of the same revision, or an upstream postgres update, moves the tag
# a running container was created from. Pulling it would leave the running
# image nameless, and the containerd image store then reports no RepoDigests,
# so create could not snapshot the previous release. A local tag in the same
# repository keeps its registry digest resolvable. Run before pulling.
keep_images() {
  local service container image_id name
  [ -f docker-compose.yml ] || return 0
  while IFS= read -r service; do
    container=$(compose ps -a -q "$service")
    [ -n "$container" ] || continue
    image_id=$(docker inspect --format '{{.Image}}' "$container")
    name=$(docker inspect --format '{{.Config.Image}}' "$container")
    name=${name%@*}
    [[ "${name##*/}" != *:* ]] || name=${name%:*}
    docker tag "$image_id" "$name:moto-release-$service"
  done < <(compose --profile '*' config --services)
}

postgres_image() {
  awk -F '\t' '$1 == "postgres" {print $2}' "$bundle/images.tsv"
}

verify_files() {
  environment
  [ -d "$bundle" ] && [ ! -L "$bundle" ] || fail 'Backup directory is missing or a symlink'
  [ "$(cat "$bundle/environment")" = "$DEPLOY_DIR" ] || fail 'Backup belongs to another environment'
  local file expected actual line name
  local files=("${required_files[@]}")
  if [[ "$(cat "$bundle/uploads-volume")" =~ $bucket_pattern ]]; then
    files+=(uploads-endpoint)
  fi
  [ -f "$bundle/checksums.sha256" ] && [ ! -L "$bundle/checksums.sha256" ] || fail 'Missing checksums'
  [ "$(wc -l < "$bundle/checksums.sha256" | tr -d ' ')" = "${#files[@]}" ] || fail 'Invalid checksum manifest'
  for file in "${files[@]}"; do
    [ -s "$bundle/$file" ] && [ ! -L "$bundle/$file" ] || fail "Missing backup component: $file"
    expected=$(awk -v name="$file" '$2 == name {print $1}' "$bundle/checksums.sha256")
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail "Invalid checksum entry: $file"
    actual=$(digest "$bundle/$file")
    [ "${actual%% *}" = "$expected" ] || fail "Backup checksum mismatch: $file"
  done
  while IFS=$'\t' read -r name line; do
    [[ "$name" =~ ^[a-zA-Z0-9_-]+$ && "$line" =~ ^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$ ]] || fail 'Invalid image manifest'
    docker image inspect "$line" >/dev/null 2>&1 || docker pull "$line" >/dev/null
  done < "$bundle/images.tsv"
  [ -n "$(postgres_image)" ] || fail 'Postgres image missing from snapshot'
  docker run --rm -i "$(postgres_image)" pg_restore --list < "$bundle/database.dump" >/dev/null
  docker run --rm --mount "type=bind,src=$bundle,dst=/backup,readonly" \
    --entrypoint tar "$(postgres_image)" -tzf /backup/uploads.tar.gz >/dev/null
  # Validate Compose without printing its resolved environment.
  docker compose --env-file "$bundle/.env" -f "$bundle/compose.yml" config -q
  local uploads
  uploads=$(cat "$bundle/uploads-volume")
  # S3 snapshots also carry a checksummed endpoint; restore checks both.
  [[ "$uploads" =~ $bucket_pattern ]] && return 0
  [[ "$uploads" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || fail 'Invalid uploads volume name'
  docker volume inspect "$uploads" >/dev/null
}

verify() {
  [ "$(cat "$bundle/complete" 2>/dev/null)" = 'moto-release-backup-v1' ] || fail 'Backup is not complete'
  verify_files
}

dedicated_cluster() {
  # The deployed Compose service owns one application database. Refuse to
  # promise a complete restore for a shared cluster or external tablespaces.
  local extra
  extra=$(compose exec -T postgres psql -X -U postgres -d template1 -At -v ON_ERROR_STOP=1 -c \
    "SELECT (SELECT count(*) FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')) + (SELECT count(*) FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global'));")
  [ "$extra" = 0 ] || fail 'Complete release backup requires a dedicated application PostgreSQL cluster'
}

create() {
  environment
  ensure_stopped
  dedicated_cluster
  [ ! -e "$bundle" ] || fail 'Backup path already exists'
  mkdir -m 700 -p "$bundle"
  # A failed copy must not leave the plaintext bucket filling the disk.
  trap 'rm -rf -- "$bundle/uploads-tree"' EXIT
  local service container image_id image_ref uploads store
  upload_store
  store=$upload_kind
  if [ "$store" = s3 ]; then
    load_bucket
    uploads="bucket:$upload_bucket"
    printf '%s\n' "$upload_endpoint" > "$bundle/uploads-endpoint"
    required_files+=(uploads-endpoint)
  else
    uploads=$(volume)
  fi
  printf '%s\n' "$uploads" > "$bundle/uploads-volume"
  # Snapshot the actual previous containers, not mutable registry tags.
  printf 'services:\n' > "$bundle/images.yml"
  : > "$bundle/images.tsv"
  while IFS= read -r service; do
    # migrate, demo-runtime, bank-data-rekey and upload-seal run the serving backend image
    # by contract; the one-shot jobs need not have a container of their own.
    case "$service" in migrate|demo-runtime|bank-data-rekey|upload-seal)
      container=$(compose ps -a -q server);;
    *) container=$(compose ps -a -q "$service");;
    esac
    [ -n "$container" ] || fail "No previous container for $service"
    image_id=$(docker inspect --format '{{.Image}}' "$container")
    image_ref=$(docker image inspect --format '{{index .RepoDigests 0}}' "$image_id")
    [[ "$image_ref" =~ @sha256:[a-f0-9]{64}$ ]] || fail "No immutable registry digest for $service"
    printf '%s\t%s\n' "$service" "$image_ref" >> "$bundle/images.tsv"
    printf '  %s:\n    image: %s\n' "$service" "$image_ref" >> "$bundle/images.yml"
  done < <(compose --profile '*' config --services)
  cp .env "$bundle/.env"
  cp .deploy-state "$bundle/deploy-state"
  compose --profile '*' -f docker-compose.yml -f "$bundle/images.yml" config --no-interpolate > "$bundle/compose.yml"
  rm "$bundle/images.yml"
  printf '%s\n' "$DEPLOY_DIR" > "$bundle/environment"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$bundle/created-at"
  compose exec -T postgres pg_dumpall -U postgres --globals-only > "$bundle/roles.sql"
  compose exec -T postgres pg_dump -U postgres -d postgres -Fc > "$bundle/database.dump"
  if [ "$store" = s3 ]; then
    # The application is stopped: the bucket matches the database dump.
    mkdir -m 700 "$bundle/uploads-tree"
    bucket_rclone "$bundle/uploads-tree" copy "uploads:$upload_bucket" /tree ||
      fail 'Copying the upload bucket failed; migration must not start'
    docker run --rm --user "$(id -u):$(id -g)" --mount "type=bind,src=$bundle,dst=/backup" \
      --entrypoint tar "$(postgres_image)" -czf /backup/uploads.tar.gz -C /backup/uploads-tree .
    rm -rf -- "$bundle/uploads-tree"
  else
    docker run --rm --mount "type=volume,src=$uploads,dst=/volume,readonly" \
      --mount "type=bind,src=$bundle,dst=/backup" --entrypoint tar "$(postgres_image)" \
      -czf /backup/uploads.tar.gz -C /volume .
  fi
  : > "$bundle/checksums.sha256"
  local file value
  for file in "${required_files[@]}"; do
    value=$(digest "$bundle/$file")
    printf '%s  %s\n' "${value%% *}" "$file" >> "$bundle/checksums.sha256"
  done
  # A failed or interrupted verification never leaves a selectable snapshot.
  if ! bash "$0" verify-files "$bundle"; then
    fail 'Backup verification failed; migration must not start'
  fi
  printf 'moto-release-backup-v1\n' > "$bundle/complete"
  trap - EXIT
  echo "Complete backup verified: $(basename "$bundle")"
}

# ADR 0203: the store of released return packages is no part of the
# snapshot and keeps its archives through a rollback, while the restored
# database brings back revoked tokens and spent downloads. Revoke every
# grant that still has an archive and record that a restore did it; a
# snapshot from before the data-return tables needs nothing. Any failure
# stops the restore with the application stopped.
revoke_data_return() {
  local present revoked=0
  present=$(compose exec -T postgres psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
    -c "SELECT to_regclass('platform.data_return_grants') IS NOT NULL;") ||
    fail 'Data return revocation failed; application remains stopped'
  if [[ "$present" == t ]]; then
    revoked=$(compose exec -T postgres psql -X -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
      -c "WITH revoked AS (UPDATE platform.data_return_grants SET revoked_at = COALESCE(revoked_at, now()), revoked_by = COALESCE(revoked_by, 'restore'), wrapped_key = NULL WHERE purged_at IS NULL AND (revoked_at IS NULL OR wrapped_key IS NOT NULL) RETURNING 1) SELECT count(*) FROM revoked;") ||
      fail 'Data return revocation failed; application remains stopped'
    [[ "$revoked" =~ ^[0-9]+$ ]] || fail 'Data return revocation failed; application remains stopped'
  elif [[ "$present" != f ]]; then
    fail 'Data return revocation failed; application remains stopped'
  fi
  echo "restore_data_return_revoked=$revoked"
}

restore() {
  verify
  dedicated_cluster
  # All preflight checks happen before stopping or deleting anything.
  local uploads services tree='' snapshot_bucket snapshot_endpoint
  uploads=$(cat "$bundle/uploads-volume")
  if [[ "$uploads" =~ $bucket_pattern ]]; then
    snapshot_bucket=${BASH_REMATCH[1]}
    snapshot_endpoint=$(cat "$bundle/uploads-endpoint")
    # Keep current credentials (key rotation), but never sync another store.
    upload_store
    [ "$upload_kind" = s3 ] || fail 'Snapshot holds bucket uploads, but the server does not use S3'
    load_bucket
    [ "$upload_bucket" = "$snapshot_bucket" ] || fail 'Snapshot holds another bucket than the server uses'
    [ "$upload_endpoint" = "$snapshot_endpoint" ] || fail 'Snapshot holds another upload endpoint than the server uses'
    tree=$(mktemp -d "$PWD/.uploads-restore.XXXXXX")
    trap '[ -z "$tree" ] || rm -rf -- "$tree"' EXIT
    bucket_rclone "$tree" lsf --max-depth 1 "uploads:$upload_bucket" || fail 'Upload bucket is not reachable; nothing was changed'
  fi
  services=$(app_services)
  # shellcheck disable=SC2086 # service names, split on purpose
  compose stop $services
  ensure_stopped
  cp "$bundle/.env" .env
  cp "$bundle/compose.yml" docker-compose.yml
  compose up -d --wait postgres
  compose exec -T postgres psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 \
    -c 'DROP DATABASE IF EXISTS postgres WITH (FORCE);' >/dev/null
  # The dedicated cluster's non-system roles must match the snapshot too:
  # replaying GRANT alone would retain privileges introduced after the backup.
  compose exec -T postgres psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
SELECT format('DROP ROLE %I;', rolname)
FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> current_user
ORDER BY rolname
\gexec
SQL
  # Restore grants strictly. pg_dumpall emits CREATE ROLE even for existing
  # roles; only duplicate-object on that statement is an accepted condition.
  local roles_log
  roles_log=$(mktemp)
  trap 'rm -f "$roles_log"; [ -z "$tree" ] || rm -rf -- "$tree"' EXIT
  if ! awk '
    /^CREATE ROLE / {
      if (index($0, "$moto_restore$")) exit 1;
      print "DO $moto_restore$ BEGIN " $0 " EXCEPTION WHEN duplicate_object THEN NULL; END $moto_restore$;";
      next
    }
    {print}
  ' "$bundle/roles.sql" | compose exec -T postgres psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 >"$roles_log" 2>&1; then
    fail 'Role restore failed; private diagnostic output was not printed'
  fi
  compose exec -T postgres psql -X -U postgres -d template1 -v ON_ERROR_STOP=1 \
    -c 'CREATE DATABASE postgres OWNER postgres TEMPLATE template0;' >/dev/null
  if ! compose exec -T postgres pg_restore -U postgres -d postgres --exit-on-error < "$bundle/database.dump" >"$roles_log" 2>&1; then
    fail 'Database restore failed; application remains stopped'
  fi
  revoke_data_return
  # ACL assertions cover the login connection and both SET ROLE paths.
  compose exec -T postgres psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT pg_has_role('phoenix_auth', 'phoenix_tenant', 'MEMBER')
     OR NOT pg_has_role('phoenix_auth', 'phoenix_admin', 'MEMBER')
     OR NOT has_schema_privilege('phoenix_auth', 'auth', 'USAGE')
     OR NOT has_schema_privilege('phoenix_auth', 'platform', 'USAGE')
     OR NOT has_schema_privilege('phoenix_tenant', 'auth', 'USAGE')
     OR NOT has_schema_privilege('phoenix_tenant', 'active', 'USAGE')
     OR NOT has_schema_privilege('phoenix_admin', 'platform', 'USAGE')
     OR NOT has_table_privilege('phoenix_auth', 'auth.accounts', 'SELECT')
     OR NOT has_table_privilege('phoenix_auth', 'platform.operators', 'SELECT')
     OR NOT has_table_privilege('phoenix_tenant', 'auth.account_tenants', 'SELECT')
     OR NOT has_table_privilege('phoenix_tenant', 'active.visits', 'INSERT')
     OR NOT has_table_privilege('phoenix_admin', 'platform.operators', 'SELECT') THEN
    RAISE EXCEPTION 'Restored application privileges are incomplete';
  END IF;
END $$;
SQL
  if [ -n "$tree" ]; then
    docker run --rm --user "$(id -u):$(id -g)" --mount "type=bind,src=$tree,dst=/tree" \
      --mount "type=bind,src=$bundle,dst=/backup,readonly" --entrypoint tar "$(postgres_image)" \
      -xzf /backup/uploads.tar.gz -C /tree
    # Like the volume: objects added after the snapshot go, changed ones return.
    bucket_rclone "$tree" sync /tree "uploads:$upload_bucket" --checksum ||
      fail 'Upload bucket restore failed; application remains stopped'
    bucket_rclone "$tree" check /tree "uploads:$upload_bucket" --download ||
      fail 'Upload bucket differs from the snapshot; application remains stopped'
    rm -rf -- "$tree"
  else
    docker run --rm --mount "type=volume,src=$uploads,dst=/volume" \
      --mount "type=bind,src=$bundle,dst=/backup,readonly" --entrypoint sh "$(postgres_image)" \
      -c 'find /volume -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/uploads.tar.gz -C /volume'
  fi
  cp "$bundle/deploy-state" .deploy-state
  rm -f "$roles_log"
  trap - EXIT
  echo 'Database, roles, uploads and previous configuration restored; application is still stopped'
}

# Caller must hold the environment's .release-operation.lock. Deploy already
# owns it; independent runs use release-backup-cleanup.sh, never this primitive.
prune() {
  local root=$1 retention=$2 days=$3 current=${4:-} current_count=0 cutoff path id stamp remove_count index
  local LC_ALL=C
  [[ "$root" = /* && "$root" != / && ! -L "$root" ]] || fail 'Invalid snapshot root'
  [[ "$retention" =~ ^[1-9][0-9]*$ ]] || fail 'Invalid BACKUP_RETENTION'
  [[ "$days" =~ ^([1-9]|[1-8][0-9]|90)$ ]] || fail 'RELEASE_SNAPSHOT_MAX_AGE_DAYS must be 1 to 90'
  # GNU date on the deployment host; BSD date for the local macOS test loop.
  cutoff=$(date -u -d "$days days ago" +%Y%m%dT%H%M%SZ 2>/dev/null) ||
    cutoff=$(date -u -v-"${days}"d +%Y%m%dT%H%M%SZ) || fail 'Cannot determine snapshot cutoff'
  [ -d "$root" ] || return 0
  local snapshots=()
  for path in "$root"/release-*; do
    [ -d "$path" ] && [ ! -L "$path" ] || continue
    id=${path##*/}
    [[ "$id" =~ ^release-([0-9]{8}T[0-9]{6}Z)-[a-f0-9]{7,40}$ ]] || continue
    stamp=${BASH_REMATCH[1]}
    # Use the UTC creation ID, not filesystem mtime. Interrupted snapshots also
    # contain sensitive data and must expire, even without a completion marker.
    if [[ "$stamp" < "$cutoff" || "$stamp" = "$cutoff" ]]; then
      rm -rf -- "$path"
    elif [ -f "$path/complete" ] && [ ! -L "$path/complete" ]; then
      # A backward clock change can sort the just-created snapshot before older
      # ones. Keep the deploy's current rollback point within the count limit.
      if [ "$path" = "$current" ]; then current_count=1; else snapshots+=("$path"); fi
    fi
  done
  # An arbitrarily large configured count needs no shell integer conversion.
  local snapshot_count=$((${#snapshots[@]} + current_count))
  [ "${#retention}" -le "${#snapshot_count}" ] || return 0
  remove_count=$((snapshot_count - retention))
  for ((index=0; index<remove_count; index++)); do
    rm -rf -- "${snapshots[$index]}"
  done
}

case "${1:-}" in
  create|verify|restore|verify-files)
    [ "$#" = 2 ] || fail 'Usage: release-backup.sh {create|verify|restore} /absolute/backup-directory'
    bundle=$2
    [[ "$bundle" = /* && "$bundle" != *','* && "$bundle" != *$'\n'* ]] || fail 'Backup path must be absolute and contain no comma or newline'
    if [ "$1" = verify-files ]; then verify_files; else "$1"; fi
    ;;
  app-services) app_services;;
  keep-images) keep_images;;
  prune)
    [ "$#" = 4 ] || [ "$#" = 5 ] || fail 'Usage: release-backup.sh prune /absolute/snapshot-root count max-age-days [current-snapshot]'
    prune "$2" "$3" "$4" "${5:-}"
    ;;
  *) fail 'Expected create, verify, restore or prune';;
esac
