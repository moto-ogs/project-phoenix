#!/usr/bin/env bash
# A disposable PostgreSQL test server whose clock scripts/fake-clock.sh moves
# together with the Go clock (#4027).
#
#   scripts/fake-clock-postgres.sh start NAME PORT DIR
#   export TEST_DB_DSN=$(cat DIR/dsn) PHX_FAKE_CLOCK_POSTGRES_DIR=DIR
#   scripts/run-go-toolchain.sh scripts/fake-clock.sh 2027-04-20T00:30 scripts/test-backend.sh -count=1 ./...
#   scripts/fake-clock-postgres.sh stop NAME
#
# Without it only Go moves: now(), CURRENT_DATE and column defaults stay on
# the real day, and tests that mix both fail for no reason a real day would
# produce. The server is the CI test server (image, max_connections,
# scram_iterations, tmpfs) plus libfaketime, which reads the offset from
# DIR/offset about once a second, so one server serves several times in a
# row. It listens on 127.0.0.1:PORT only, has a generated password in
# DIR/dsn (mode 600), carries no Compose labels (the test harness never stops
# or reuses it) and loses its data on stop. Never point it at the shared
# test server's port.
set -euo pipefail

IMAGE=postgres:17.12-alpine3.24@sha256:34261f594522cf41dfcb76aefd42b9d201098b0e6b23c9c68733f169e4218b6f

usage() {
  echo "Usage: scripts/fake-clock-postgres.sh start NAME PORT DIR | stop NAME" >&2
  exit 2
}

case "${1:-}" in
  start)
    (($# == 4)) || usage
    name=$2 port=$3 dir=$4
    mkdir -p "$dir"
    dir=$(cd "$dir" && pwd)
    echo "+0" > "$dir/offset"
    password=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
    # libfaketime comes from Alpine's community repository at start: the
    # pinned image stays the one CI tests with. Monotonic clocks stay real.
    docker run -d --rm --name "$name" \
      -p "127.0.0.1:$port:5432" \
      --tmpfs /var/lib/postgresql/data:rw,size=4g \
      -v "$dir:/faketime:ro" \
      -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=phoenix_test \
      -e TZ=Europe/Berlin \
      -e POSTGRES_INITDB_ARGS="--set max_connections=300 --set scram_iterations=1" \
      --entrypoint sh "$IMAGE" -c '
        apk add --no-cache libfaketime > /dev/null
        export LD_PRELOAD=/usr/lib/faketime/libfaketime.so.1 \
          FAKETIME_TIMESTAMP_FILE=/faketime/offset FAKETIME_CACHE_DURATION=1 \
          FAKETIME_DONT_FAKE_MONOTONIC=1
        exec docker-entrypoint.sh postgres' > /dev/null
    for _ in $(seq 1 120); do
      if docker exec "$name" pg_isready -U postgres -h 127.0.0.1 > /dev/null 2>&1; then
        # The entrypoint restarts the server once after initdb.
        sleep 1
        docker exec "$name" pg_isready -U postgres -h 127.0.0.1 > /dev/null 2>&1 || continue
        umask 077
        echo "postgres://postgres:$password@127.0.0.1:$port/phoenix_test?sslmode=disable" > "$dir/dsn"
        echo "fake-clock-postgres: $name on 127.0.0.1:$port, DSN in $dir/dsn" >&2
        exit 0
      fi
      sleep 1
    done
    docker logs "$name" >&2 || true
    docker stop "$name" > /dev/null 2>&1 || true
    echo "fake-clock-postgres: $name did not become ready" >&2
    exit 1
    ;;
  stop)
    (($# == 2)) || usage
    docker stop "$2" > /dev/null
    ;;
  *) usage ;;
esac
