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

## School: assigned-class cards

On an authenticated cold document, the teacher's assigned-class totals use
one Go GET and no browser GET. The SWR seed contains totals only. A visible
burst of school-day changes causes one browser and Go GET; a hidden tab waits
until visible. The first class sheet is a separate audited browser read.
The query budget, including the school's transaction, is independent of
whether the caller has one, three or six classes
(scenario `modules.classday.assigned_classes`).

For the local browser measurement, run `school-class-counts.perf.ts` with
`playwright.perf-dev.config.ts`, `PERF_PORT` for the seeded native stack
and `PERF_SCHOOL_FIXTURE` for the executable fixture command. The command
receives `1`, `3` or `6` to set the seeded teacher's class assignments, or
`event` to emit a child change for that school. Use only the isolated local
database. The recorder reports encoded browser response bodies; match its
time windows to the backend's tenant request log for Go GETs and body bytes.
The route test measures SQL statements for the old and new read paths over
the same fixture. `PERF_BASELINE=1` compares against a checkout before #8092.

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
