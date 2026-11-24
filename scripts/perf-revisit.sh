#!/usr/bin/env bash
# Use this checkout's seeded native backend and its own frontend port.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec scripts/dev-native.sh frontend sh -c 'export PERF_PORT="$FRONTEND_HOST_PORT"; exec pnpm run perf:nav --grep "measure revisit"'
