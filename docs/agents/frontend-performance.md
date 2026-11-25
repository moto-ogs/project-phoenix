# Frontend performance guardrails

Read before changing bundle baselines, shell rendering, or performance tooling.
Paths below are relative to `frontend/` except `.github/` and `docs/`.

## Ratchets and evidence (#2939)

- **Bundle gates** (`Lint / Frontend build`): Feature-PR growth per route must not exceed `max(10 KiB, round(merge-base bytes × 0.02))` (`deltaTolerance` in `scripts/perf/bundle-policy.mjs`). A feature that needs more JS is allowed to grow: first check lazy loading (`next/dynamic`, `import()` on interaction) and lighter libraries; if the growth remains, set the PR label `bundle-growth-approved`, give the reason in the PR description and rerun the failed jobs (`gh run rerun <id> --failed`). The label turns delta failures into warnings for that PR only; it is read from the API on every run, so a rerun sees it. Absolute ceilings exist only for a few heavily used routes in `scripts/perf/bundle-ceilings.json` (framework floor `/_not-found`, portal logins and start pages, daily tenant pages), set generously above the measured state; the label does not waive them, raise one in the PR with a reason. Other routes, including new ones, need no policy entry. A ceiling crossing fails while the merge-base keeps at least 1 KiB (`NEAR_CEILING_BYTES`) of headroom; a merge-base already at or over it only warns on the PR (#5396). Development pushes, the nightly and release PRs into `main` have no merge-base and check only the ceilings. A ceiling without a measured route fails, so a renamed route moves its entry.
- **Exact comparison**: The regular merge-integration build runs in `Lint / Frontend merge build`. In `Lint / Frontend build`, feature PRs switch to their exact head and compute `git merge-base HEAD <event base SHA>`. The feature head compiles cold in every run. Its merge-base compiles cold with the same Node/platform/environment and parser, from a disposable Git archive with its own frozen lockfile, removed even on failure; that measurement is then cached under the base's frontend source tree and build configuration (`measurementKey`) and reused by later runs of the same pull request, because two cold builds of one tree are byte-identical (#2939) and the cold build took 87–166 s per run. A restored file counts only as a valid measurement of exactly that identity; anything else is built cold again. A pull request reads only its own cache entries, so no other pull request or fork can supply one, and no token is passed to the base build. Missing requested measurements, malformed analysis or stale source/configuration fail closed. Both measurements and their base identity are archived for 14 days. There is no age-dependent lookup or fallback to historical approved references.
- **Workflow selection**: a `lint.yml`-only PR selects both frontend checks and the reusable `frontend-build` job through the `workflow-lint` filter; docs-only PRs still skip them. Source-contract tests evaluate the real workflow expressions for release, feature, stacked, nightly and lint-only contexts.
- **Policy ownership**: frontend maintainers review label approvals and ceiling changes in the PR. Observations never change policy. Shared client code is included in each affected route, not summed as a fictitious total bundle. The per-route budget files and their stale-reference ratchet (#5483) were removed in favour of the delta gate; [`docs/perf/bundle-ratchet-5483.md`](../perf/bundle-ratchet-5483.md) is history.
- **Local reproduction** (from `frontend/`, inside Devbox, with the normal local performance environment): commit frontend sources, then run `node scripts/perf/bundle-measurement.mjs --prepare-ci "$(git merge-base HEAD origin/development)"`, `node scripts/perf/bundle-measurement.mjs --build-base`, and `pnpm run perf:bundle-ratchet`. This is the same cold two-tree comparison as CI. Local results are platform-specific and must not replace Linux measurements. For release/nightly reproduction on the corresponding tested tree, run `node scripts/perf/bundle-measurement.mjs --prepare-ci` without a base and then `pnpm run perf:bundle-ratchet` without `--build-base`; this resets old delta metadata and checks the ceilings only. The extra base analysis/install is intentional: missing observations cannot silently disable the PR gate.
- **Cold analysis and regular build**: both remain required. Chunk splits depend on Turbopack's incremental cache, so head analysis parks/restores that cache and compiles cold. `--skip-analyze` accepts only diagnostics matching the committed source/configuration. The ordinary `next build` runs first on GitHub's synthetic merge to catch semantic integration failures before merging, then feature measurements switch to the head and reinstall its frozen lockfile. Head-only analysis does not prove merge compatibility; retaining the existing regular build on the merge closes that gap without an additional Next.js build (only a second, usually no-op install). Release PRs stay on the merge tree; nightly/push use their checked-out revision. Versioned observations remain separate from the ceiling policy.

- **Render budget** (Vitest, blocking): `expectIdleRenderBudget` from `src/test/render-budget.tsx` counts `<Profiler>` commits over 5 s of fake-timer idle and caps them at 20; `mobile-bottom-nav.test.tsx` and `sidebar.test.tsx` use it. A new effect loop in the shell trips this regardless of runner speed. Keep the cap; fix the loop. Reuse the helper for any new always-mounted component.
- **Nightly counters** (`.github/workflows/perf-nightly.yml`, non-blocking): runs `pnpm run perf:trace` and `pnpm run perf:render` against a seeded backend on weeknights and via `workflow_dispatch`; the report lands in the job summary and as a 30-day artifact. Compare counters (requests per screen, duplicates, longest chain, renders per interaction) with `docs/perf/frontend-baseline-2026.md`; runner timings are not comparable across machines. Timing-based numbers (LCP, Lighthouse) are deliberately not gates.

## Revisit baseline: all portals (#8080)

The #8080 reference host for #8083 is **`rechenzentrum`** (Linux x86_64, 32 logical CPUs).
Use that same machine and browser version for both sides of a performance comparison;
a Mac run is a smoke test, not its counterpart. Use a private clone, its own native
backend bound to loopback (`PORT=127.0.0.1:<port>` for the server), and separate
loopback-only Postgres/Mailpit Compose ports. The benchmark binds Next to loopback.

### Set up the reference host

In a fresh, private clone, fetch the intended `development` and feature refs.
The report records their merge base and `HEAD:frontend/src`; compare the latter
to the product revision under test. Use `scripts/setup-dev.sh` to generate local
credentials and certificates (keep setup and seed output private). In the private `.env`, choose a unique
`COMPOSE_PROJECT_NAME` and five free ports (reference: frontend 14280, API 14281,
Postgres 14282, Mailpit UI 14283 and SMTP 14284). Update the localhost URLs
in `.env`, `backend/dev.env` and `frontend/.env.local` for these ports.
Set `AUTH_TRUST_HOST=true` for the localhost production build, and keep analytics
and error reporting disabled. Use a four-digit local `OGS_DEVICE_PIN`.

In the generated **private** `docker-compose.yml`, prefix each of the three
Postgres/Mailpit port mappings with `127.0.0.1:`. On Linux, prepare the key and
public files in this clone, then start **only** its two infrastructure services:

```sh
sed -i -E 's/"(\$\{(POSTGRES_HOST_PORT|MAILPIT_HOST_PORT|MAILPIT_SMTP_HOST_PORT)\}:)/"127.0.0.1:\1/' docker-compose.yml
chmod 644 config/ssl/postgres/{postgresql.conf,pg_hba.conf,certs/server.crt,certs/ca.crt}
chmod 600 config/ssl/postgres/certs/server.key
docker run --rm --network none --user 0 --entrypoint chown \
  -v "$PWD/config/ssl/postgres/certs/server.key:/server.key" \
  "$(docker compose config --images postgres)" postgres:postgres /server.key
docker compose up -d --wait postgres mailpit
docker compose ps  # All three published ports must show 127.0.0.1
```

If the Docker subnet pool is exhausted, use the
[worktree-only network procedure](operations.md#new-managed-worktree).
Install the frontend dependencies (`cd frontend && pnpm install --frozen-lockfile` inside Devbox).
In a Devbox shell (`devbox shell`), start the native API in the foreground from the repository root:

```sh
scripts/dev-native.sh backend sh -c 'mkdir -p ../tmp && go build -o ../tmp/revisit-api . && ../tmp/revisit-api migrate && PORT="127.0.0.1:$SERVER_HOST_PORT" exec ../tmp/revisit-api serve'
```

The reference browser is sandboxed **Google Chrome for Testing 158.0.8127.88**.
With no matching system Chrome, download the [official Linux archive](https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.88/linux64/chrome-linux64.zip)
into a private directory, verify it and unpack it there:

```sh
echo '59e3b43f8b3aaa292238fbdcfb36a93127debd53e212510dcdc2cc8812b4b57e  chrome-linux64.zip' | sha256sum -c -
unzip -q chrome-linux64.zip
export CHROME_DIR="$PWD/chrome-linux64"
```

On `rechenzentrum`, the single measurement command from the repository root is
`bwrap --dev-bind / / --tmpfs /opt --dir /opt/google --ro-bind "$CHROME_DIR" /opt/google/chrome devbox run -- scripts/perf-revisit.sh`.
The host's **bubblewrap** package exposes this Chrome only inside the benchmark
process. For #8083, run flags off and on on **the same Berlin calendar day**,
against the same prepared database and day receipt. If the comparison moves to
a later day, start a new pair on a fresh seed and simulate once; do not append a
second simulated day and compare it to the previous day's results.

### Prepare the fixture and repeat

In a fresh stack, create the [standard seed](../getting-started.md). From the
repository root in another Devbox shell with the local API running:

```sh
(umask 077; scripts/dev-native.sh backend sh -c 'go run ./cmd/devtools seed --email "$OPERATOR_EMAIL" --password "$OPERATOR_PASSWORD" --pin "$OGS_DEVICE_PIN" --url "$API_URL"' >tmp/revisit-seed.log 2>&1)
scripts/perf-revisit.sh --prepare-day
```

Prepare the day once. This simulates a full day in `vollbetrieb` without a clock
override and records only aggregate counts, bound to the seed timestamp and
Berlin date. The benchmark requires that receipt and the private v3 seed state
with the confirmed Caterer login. Do not copy
credentials into environment examples or results. Leave the worktree frontend
port free. Check `uptime` and, if installed, `~/bin/agent-heavy --status` before measuring.

From the repository root, **`devbox run -- scripts/perf-revisit.sh`** runs the
existing `pnpm run perf:nav` Revisit test. Playwright builds and starts Next in
production mode on the worktree port and stops it afterward. Do not substitute
a dev server, a remote backend, a nightly trace or a CI runner. The test runs
serially; allow time for all three rounds. `PERF_REVISIT` can select comma-separated
journey names for diagnosis only. A partial result is not a baseline. The report identifies the measured checkout,
its frontend and backend trees, its merge base and whether it was dirty.
Page traversals, in-page actions and device/input variants have separate budget counts.

### What is timed

- Fresh Chromium context per route, role, device and round. The seed supplies
  authenticated accounts, real entity IDs and expected content; session cookies
  stay out of the reports. The source page settles before the first action.
  “First” means first visit to the target from a running app, not a hard document
  load. Ordinary viewport prefetch is not disabled.
- Desktop: CPU ×4, 150 ms latency, 3 Mbit/s down, 1 Mbit/s up. Parents also use
  Pixel 7 touch at 1.6 Mbit/s down. Time starts at the browser event timestamp, including input queueing, for pointer-down,
  touch-start, Enter or the actual history traversal. No synthetic hover or
  dwell. Stop on the next animation frame after the correct content was first
  rendered and remains visible (one paint opportunity), not at URL change, shell mount or network idle. The keyboard case
  focuses the link and presses Enter without a dwell.
- Warm 1 returns by a fresh click; Back 1 makes a history traversal. Warm 4 and
  Back 4 visit at least four distinct *other* pathnames before returning to the
  same target. Multiple URL parameters of a single route do not count as four.
  Normal in-session navigation must load **zero** new documents, including the
  intermediate routes. No wall-clock number gates PR CI.
- Each criterion checks rendered, enabled content outside hidden, inert and busy
  subtrees. Entity-specific markers or the chosen query distinguish targets
  with the same shell. Action controls, data rows or a confirmed empty state
  are required; a page title alone never qualifies. The separate two-family
  fixture rejects the old family's content and a hidden matching link on the
  same pathname, then requires the second family's actual child card after
  login. Logout confirmation and a signed-out bookmark are reported separately.
  For an actual rights change the school admin temporarily changes **one seeded**
  child's guardian relationship to pickup-only. The ordinary family home must
  show the still-permitted sibling without the former child. The versioned
  school form command restores the original preset and the fixture verifies
  the child is visible again. This is a separate fresh-document measurement,
  not a probe of cached child records.
- Same-page dialogs and filters without their own history entries have no Back
  time: opening the parent absence form does **not** submit it; the caregiver's
  regular daily plan is measured via its sidebar entry and browser history. The
  additional read-only weekly plan changes day/week with `replaceState`. For the day view the first usable blocks must match the full set of titles and times after the target request settles; no block content is archived. Caterer has just
  two protected routes, orders and account. Period and school expansion operate
  on the orders page. None can supply four distinct intermediate routes.
- Timing stops before the network diagnostic window: after the intervening pages have settled, all non-noise requests from
  action preparation through 1.5 s quiet (25 s cap) are counted, including runs
  below budget. RSC/JS/BFF are request counts, not necessarily transferred bodies.
  Visible loading indicators are recorded separately. Host load averages and
  CPU idle percentage describe the shared machine, not just Chromium. Before the series and each individual trial, the harness waits for a five-second window with at least 50% CPU idle;
  contention during a trial is recorded and marked, never used to discard slow values. A median within 20 ms of the budget is flagged, not evidence of a code-level difference. Host-admission waits do not use the four-hour browser budget. A run crossing Berlin midnight fails rather than mixing seed days.

### Coverage and evidence

The reference catalog walks every `src/app/**/page.tsx`, checks portal prefixes
against `src/proxy-pages.generated.ts` in both directions, and gives every page a
group, representative and reason. A representative is **not** a timing claim
for an unmeasured member. Public entry points and token-bound, one-time or
writing flows are separate from reusable authenticated content.

[#4986](https://github.com/moto-ogs/project-phoenix/issues/4986) published six
named transition rows and two hard loads, not the identity and direction of
all 24 counted transitions. The six current equivalents are Admin search,
supervision, time, care plan, requests, and parent home → child. Other named
flows are reconstructed from the linked October issues:

| Source | Current equivalent |
|---|---|
| #4988, #4989 | Caregiver home, own group via sidebar/home card, supervision and search |
| #4993, #5008 | Staff and room detail; child record from search, group, room, absences and statistics |
| #4994, #5013 | Parent home ↔ child, absence form and messages |
| #5010 | Weekly staff shift plan |
| #5014 | Provider school list → holiday periods → selected period |
| #5015 | Operator accounts, organization detail and school detail |
| #5016 | Teacher day/class context and Caterer order period |

The October totals (Back: 11/24; warm: 0/24 under 150 ms) are historical, not
today's denominators. Unpublished entries, directions and frequencies cannot be
assigned a time by subtraction. Do not compare the new matrix as a paired
24-row series. Its supplementary routes and short/long excursions are explicit.

For the #8080 baseline, see the [per-journey results](../perf/revisit-8080/results.md),
[raw observations](../perf/revisit-8080/observations.json), and [route catalog](../perf/revisit-8080/catalog.json).
This run used the product code at `development@de207b1c8f` and harness
`3d15b19eee`. Across trials the shared host had
0–71% idle CPU (median 20%); cross-worktree load was not controlled.
#8099, #8100, #8098 and #8102 landed during this run. The numbers predate
those changes. For a paired cache-flag comparison on a later revision, run the
same command on that revision before and after enabling the flags.

Local outputs in `frontend/perf-results/navigation/`: `revisit.json` (per-run
observations, profile, load, diagnostics and separate confirmation/denial),
`revisit.summary.json` (per-step medians, samples and range), `revisit.md`
(compact table) and `revisit.catalog.json` (route census). Only aggregate
diagnostics and fixture-independent labels belong in published evidence.
Do not publish Playwright error contexts, seed state, per-request URLs, session
files or browser screenshots. A median must be **strictly below 150 ms** to
meet the target; slow results remain valid evidence.

## Parents: start cards

Measure the children, feature flags and today's statuses together, separately
from the profile, message counts and feeds. A cold, unseeded start reads
`GET /parent/me/family-start` once at the browser and Go boundaries regardless
of family size. Behind it, Go reads each school's children as one set: the
statement count grows with the schools, not with the children of a school,
pinned by the query budget `parent.me.family_start.http_positive_growth`.
On a seeded document navigation, the protected layout and page
share one Go read; hydration uses that family snapshot without a browser GET.
Public pages receive no family seed. A child event narrows that request by `student_id`; a reconnect
or an unqualified event reloads the family. Compare response-body bytes on the
same seeded families, not the number of children returned by unrelated feeds.

## Parents and public enrollment: message payload

The request catalog is complete on the server, including the German fallback.
On these two surfaces, pass formatted strings to client components when possible.
For interactive translations, declare a `messageBoundary(...paths)` in the
server page or a layout shared by exactly those routes. List the controls and
dialogs rendered there too: nested next-intl providers replace their parent's
messages. Select individual paths when only a few labels of a namespace are
used. Dynamic API errors still go through the shared error display path.

Measure a cold login's encoded document (includes inline RSC) separately from
its JavaScript. A standalone Flight response is an alternative request, not
additional bytes on the document load. Use the Pixel 7 profile from #4986:
4× CPU, 150 ms latency, 1.6 Mbit/s down, median of three cold contexts, until
the sign-in button is visible.

## Betreuungsplan: grid and attendance

The server seed and the browser both request `GET /api/timetable/instances?view=slim`
with the grid window and filters. Slim keeps student IDs, counts, conflicts and
the block version; it skips the child DTOs and pickup cutoffs. Omitting `view`
still returns the full list. Opening a block reads only
`GET /api/timetable/instances/{id}/attendance`. The SWR key includes the block
ID and planned date inside the school/account scope. The separate
`/participants` route applies name visibility; attendance contains no names.
Measure seeded document navigation separately from the first and repeated click.
