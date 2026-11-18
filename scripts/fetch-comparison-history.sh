#!/usr/bin/env bash
# Completes a depth-1 checkout for the backend tests: full ancestry of HEAD,
# origin/development and an optional stack base, plus the files of the commits
# the tests compare against.
#
#   scripts/fetch-comparison-history.sh [base-ref]
#
# The history comes without blobs. The tests read historical files only at
# the merge base with a comparison ref (register and architecture ratchets)
# or at its tip (check-migration-versions.mjs --late), so one more request
# loads the blobs of those commits that the checkout did not bring: the
# files that differ from HEAD. Any other historical blob still loads on
# demand, one request per file.
#
# With all blobs the fetch took 56 s against 14 s for both requests on one
# machine, and the test job waited 7-16 s for it after its setup steps
# (30 pull request runs, 14.-16.11.2026, #7195).
set -euo pipefail
base_ref=${1:-}

refs=("$(git rev-parse HEAD)" "+refs/heads/development:refs/remotes/origin/development")
comparisons=(origin/development)
if [ -n "$base_ref" ] && [ "$base_ref" != development ]; then
  refs+=("+refs/heads/$base_ref:refs/remotes/origin/$base_ref")
  comparisons+=("origin/$base_ref")
fi

# Full ancestry keeps merge-base intact. Unrelated refs and tags are not
# test inputs.
git fetch --no-tags --unshallow --filter=blob:none origin "${refs[@]}"

commits=()
for ref in "${comparisons[@]}"; do
  commits+=("$(git rev-parse --verify "$ref^{commit}")" "$(git merge-base HEAD "$ref")")
done
missing=$(git rev-list --objects --missing=print --no-walk "${commits[@]}" | sed -n 's/^?//p' | sort -u)
if [ -z "$missing" ]; then
  echo "Comparison commits are complete"
  exit 0
fi
echo "Fetching $(wc -l <<< "$missing") blobs of the comparison commits"
# The request git itself sends for a lazy fetch, for all objects at once.
git -c fetch.negotiationAlgorithm=noop fetch --no-tags --no-write-fetch-head \
  --recurse-submodules=no --filter=blob:none --stdin origin <<< "$missing"
