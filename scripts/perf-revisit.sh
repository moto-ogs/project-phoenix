#!/usr/bin/env bash
# One repeat measurement on this checkout's seeded native backend.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
case "${1:-}" in
  --prepare-day)
    # Save only aggregate evidence. A broken simulation must never leave a
    # receipt for a partial day, even when it printed some summary lines.
    mkdir -p tmp/dev-native
    receipt=tmp/dev-native/revisit-day.txt
    rm -f "$receipt"
    staged=$(mktemp "$receipt.XXXXXX")
    trap 'rm -f "$staged"' EXIT
    node -e '
      const fs = require("node:fs");
      const seed = JSON.parse(fs.readFileSync("backend/.seed-state.json", "utf8"));
      const url = new URL(seed.base_url);
      if (url.protocol !== "http:" || url.hostname !== "localhost" || !seed.profiles?.vollbetrieb || !seed.created_at)
        throw Error("Local vollbetrieb seed required");
      console.log(seed.created_at);
      console.log(new Date().toLocaleDateString("sv-SE", {timeZone:"Europe/Berlin"}));
    ' > "$staged"
    scripts/dev-native.sh backend go run ./cmd/devtools simulate full-day --profile vollbetrieb |
      awk '/^--- Simulation Summary ---$/ {summary=1; next}
           summary && /^  (Sessions started|Attendance records|Students checked in|Early pickups|Messages written): +[0-9]+$/ {print; seen++}
           END {if (seen != 5) exit 1}' >> "$staged"
    mv "$staged" "$receipt"
    echo 'Full-day simulation completed; saved aggregate counts.'
    ;;
  '') exec scripts/dev-native.sh frontend sh -c 'export PERF_PORT="$FRONTEND_HOST_PORT"; exec pnpm run perf:nav --grep "measure revisit"' ;;
  *) echo "Usage: $0 [--prepare-day]" >&2; exit 2 ;;
esac
