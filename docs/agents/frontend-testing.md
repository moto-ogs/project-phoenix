# Frontend tests: clock, timers, network, absence assertions, kit pixel comparison, touch targets, Storybook a11y

Read before writing or diagnosing a date- or time-sensitive Vitest test,
Playwright spec or story, a
test that asserts something is absent, or before proving that a kit change
is invisible, or when a Storybook a11y test fails or a test reports a
request that reached the network.
Paths start at `frontend/`; commands run from `frontend/`.

## Projects

`vitest.config.ts` runs four projects. `api-node` covers `src/app/api/**`.
`logic-node` runs the files listed in `src/test/node-test-files.ts` in the
node environment with only `setup-common.ts`. Everything else runs in
`app-dom` (happy-dom plus `setup.ts`). List a new `*.test.ts` in
`node-test-files.ts` when it renders nothing and uses no DOM, window, storage,
next-intl, SWR or tenant-context mock, and confirm it passes with
`pnpm vitest run --project logic-node`. Keep a test in `app-dom` when a module
it imports branches on `window`, `document` or storage: under node it would
pass on the server branch only.

`scripts/test-changed.sh` runs only the filesystem guards when the frontend
itself did not change (backend or Markdown inputs). Locally it skips that run
when every non-ignored file, the installed dependencies, the frontend env files
and Node are unchanged since the last pass; `PHX_GUARDS_CACHE=off` forces it.
CI never reuses a result.

`school-date-dom` runs the school-date component suites listed in
`schoolDateTestFiles` in `frontend/vitest.config.ts`, using happy-dom and forked
processes. Its regression cases change `TZ` to UTC, Pacific/Honolulu and
Pacific/Kiritimati at runtime (the original sick-report suite also uses Tokyo);
Node worker threads do not apply those timezone changes. The cases assert the
local date first so an ineffective timezone change cannot hide the defect.
It runs first (`groupOrder` 0), then `api-node` and `logic-node`, then
`app-dom`.

## Reused workers

All projects run with `isolate: false`: one worker thread (a process for
`school-date-dom`) runs many test files. `src/test/setup-worker-reuse.ts`, the
first setup file, resets after every file what a fresh worker would not have:
evaluated modules and `vi.mock` registrations, the file's `vi.spyOn` spies and
its mocks in the registry that `vi.clearAllMocks` walks, globals and
prototypes, Node's builtin modules with their exported classes and prototypes
(a patched
`ServerResponse.prototype` kept the previous file's module instances), the DOM
with cookies, URL and viewport, listeners on window/document/html/head/body,
pending Node and window timers, and `process.env`. A property it cannot restore
fails the file. `src/test/reused-threads-pool.ts` bounds each thread's heap and
replaces a thread after a file that leaves more than 200 MB of heap.

- Never rely on state from another file; the file order in a worker is
  arbitrary. A package whose module state must start fresh in every file
  (Testing Library, SWR, next-auth) belongs in `perFileDependencies` in
  `vitest.config.ts`. A non-configurable global that a natively loaded package
  keeps for the worker's lifetime goes into `WORKER_LIFETIME_KEYS` with its
  reason.
- Every test ends on a fresh macrotask (`setup-common.ts`), so work the test
  left pending runs before the next test. Timers are the exception: happy-dom
  sends `hashchange` after `history.replaceState` from a `setTimeout`, and it
  can reach the next test (`portal-shell-scroll.test.tsx` waits for it in
  `beforeEach`). Act only on what the test awaited:
  after `await screen.findBy…(A)` or `await waitFor(() => expect(mock)…)`,
  query a different element B with `findBy…`, and wait for a button to be
  enabled before clicking it.
- Check order independence with
  `pnpm vitest run --sequence.shuffle.files --sequence.seed=<n>`, and with
  `--maxWorkers=1` for the most sharing.
- Transformed modules persist across runs in
  `node_modules/.experimental-vitest-cache` (`experimental.fsModuleCache`),
  keyed by file content, Vite config and lockfile. A Vite plugin whose output
  depends on other files must add them to the cache key; after a suspected
  stale transform, `pnpm vitest --clearCache` empties the cache.

## No network

`src/test/network-guard.ts` (installed by `setup.ts`, both DOM projects)
answers every `fetch` no mock handles with a network error and fails the
test that sent it, naming the request and the calling code (#7216). A
request sent after its test ended fails the next check (next test or the
file's `afterAll`), still under the sending test's name. Such a
request went to `http://localhost:3000`: refused in CI, answered by a local
dev server, possibly after the test ended. Mock the API module function the
component calls, with the neutral value its type declares (empty list, no
data); a test of the failure path mocks the rejection itself.

## Scope

Every Vitest test in all projects (`app-dom`, `school-date-dom`, `api-node`, `logic-node`) runs
on a
deterministic clock (#3101). `src/test/setup-common.ts` freezes `Date` at
`TEST_CLOCK_INSTANT` before each test and normally restores the real clock
afterwards. If a file enables fake timers in module scope or `beforeAll`, the
setup preserves that mode while resetting its system time before each test. If
a test releases fake timers, the setup restores them after that test so the
scope's `afterAll` can release them. The file restores real timers in
`afterAll`.
`vitest.config.ts` pins the zone to `Europe/Berlin`, so the frozen instant is
always Wednesday, 9 September 2026, 12:00 Berlin time (`TEST_CLOCK_TODAY` =
`2026-09-09`).

The freeze covers `new Date()` and `Date.now()` everywhere in the worker: the
test body, the rendered component tree, and libraries such as react-day-picker
and date-fns. Mocking a domain hook (`useBerlinToday`, `todayISO`) no longer
leaves a calendar or a relative-time label on the CI host's date.

Only `Date` is frozen. `setTimeout`, `setInterval`, promises and Testing
Library's `waitFor` keep running on real timers; async tests behave as before.

## Use

Helpers live in `src/test/clock.ts` (`~/test/clock`).

| Need | Use | Never |
|---|---|---|
| The default instant or day | `TEST_CLOCK_INSTANT`, `TEST_CLOCK_TODAY` | a literal copied from the setup |
| A day relative to the default day (fixture, expected argument) | `testClockDay(-7)` | a literal such as `"2026-09-02"` that only fits the default day |
| Another point in time (Berlin midnight, week change, DST switch) | `setTestClock("2026-03-29T01:30:00+01:00")` in the test or `beforeEach` | `vi.useFakeTimers({ toFake: ["Date"] })` boilerplate; the setup already freezes `Date` |
| Control timers (`setInterval`, debounce) | `vi.useFakeTimers()`; it starts at the frozen instant, `vi.advanceTimersByTime` moves clock and timers | assuming fake timers start at the host time |
| Real event loop again mid-test | `releaseFakeTimers()`: timers become real, the clock stays where the fake timers left it | `vi.useRealTimers()` in a test body or `before*` hook |
| Cleanup | nothing; the setup restores the clock and uninstalls fake timers after every test, except file-scoped fake timers, which the file restores in `afterAll`. `afterEach(() => vi.useRealTimers())` stays allowed | `vi.useRealTimers()` inside `try … finally` |
| Wall-clock time on purpose | `useRealClock("reason")` with the reviewed reason as a string literal | `vi.getRealSystemTime()`, `vi.stubGlobal("Date", …)`, `globalThis.Date = …` |

A test that mocks a domain hook to one day while the component tree reads
another day is deterministic but asserts a mismatch. Prefer `setTestClock` and
let the hook read the frozen clock unless the mismatch is the behaviour under
test.

Fixtures built relative to "now" (`Date.now() + 60_000`, `new Date()`) stay
valid: fixture and product code see the same frozen instant. Fixtures that use
`Date.now()` for uniqueness collide within one test; use a counter instead.

## Moved clock

The default instant is one plain Wednesday. `clock-early-warning.yml` runs the
suite every Sunday at the coming boundary times of
`scripts/clock-boundaries.mjs` (00:30 Berlin, weekend, ISO week, clock change,
new year, NRW holidays, today plus 30, 90 and 365 days) with
`TEST_CLOCK_INSTANT=<ISO instant>` moving the default (#7296). Code that
breaks on such a day fails there although no test sets that day; a red run
opens the issue „Zeitabhängige Frontend-Tests: Frühwarn-Lauf mit verstellter
Uhr ist rot“.

A pull request does not wait for Sunday: `scripts/test-frontend-changed.mjs`
(CI's frontend test jobs and `check-changed.mjs`) runs every Vitest test file
the change adds or edits a second time with the clock on Saturday 2 January
2027, 00:30 in Berlin (`MOVED_CLOCK` there, #7337): another year, a weekend,
winter time, a Berlin day ahead of the UTC day. Reproduce from `frontend/`:
`TEST_CLOCK_INSTANT=2027-01-01T23:30:00.000Z pnpm vitest run <file>`.

- A test must pass on any default day. Take today from `TEST_CLOCK_TODAY`
  and other days from `testClockDay(n)`; compute an expected weekday or week
  with plain arithmetic in the test, not with the helper under test.
- A test about one particular day (a Monday, a holiday, the clock change, a
  fixture world with fixed dates) sets it with `setTestClock(...)` in the test
  or `beforeEach`. It then no longer follows the moved clock.
- Reproduce from `frontend/`:
  `FAKE_CLOCK_TIMES=2027-03-28T00:30 ../scripts/test-frontend-clocks.sh /tmp/out src/path/file.test.tsx`,
  or one run with `TEST_CLOCK_INSTANT=2027-03-27T23:30:00Z pnpm vitest run <file>`.

## Playwright and Storybook

Outside Vitest nothing freezes the clock for the test code.

- **Flows (`e2e/*.spec.ts`).** Browser, Next server, backend and database
  read the machine's clock. `e2e.yml` moves the runner clock to the next care
  day (a weekday that is no NRW holiday) before migrations and seed, so every
  run has shifts and a week grid. A spec takes its day from `runToday()` and
  sets the browser's today with `setBrowserDay(page, day)` (`e2e/clock.ts`);
  server and backend then stay on the run's day, so such a flow writes only
  data with an explicit date. Durations and deadlines use
  `performance.now()`, unique names `uniqueTitle()`. A comparison with a
  foreign wall-clock stamp (Mailpit, a file time, a token's `exp`) calls
  `realClock("reason")` from `e2e/real-clock.mjs`.
- **Layout and network suites** render fixed markup or a synthetic backend
  and assert no calendar day.
- **Stories.** The Storybook tests (`.storybook/vitest.setup.ts`) and the kit
  pixel comparison freeze `Date` at `TEST_CLOCK_INSTANT`, timers keep running.
  Interactive Storybook runs on the real clock, so a story takes the time from
  `storyNow()` (`.storybook/clock.ts`) instead of a fixed date.
  `src/components/storybook-clock.stories.tsx` is the regression test.

## Enforcement

- `src/test/clock.test.tsx` is the regression test of the mechanism: a pinned
  hook supplies the explicit today marker to the real kit `DatePicker`, while
  the independent `Date`/`Date.now()` assertions remain on the frozen instant.
  `setTestClock` covers Berlin midnight, a week change and the DST switch,
  and time and timer state reset between tests.
- oxlint rule `test-clock/no-real-clock`
  (`scripts/oxlint-plugin-test-clock.mjs`, tested in
  `scripts/oxlint-plugin-test-clock.test.ts`) runs in `pnpm run check` and CI.
  It rejects `vi.useRealTimers()` outside `afterEach`/`afterAll`,
  `useRealClock()` without a non-empty literal reason, `vi.getRealSystemTime()`
  and statically identifiable replacement of the global `Date`, including
  direct assignments and `Object.defineProperty` / `Reflect` writes. In
  `e2e/`, `.storybook/` and `*.stories.*` it rejects every read of the host
  clock outside `e2e/clock.ts` and `.storybook/clock.ts`: `new Date()`,
  `Date.now()`, `berlinTodayISO()` and `todayISO()`, and `realClock()` without
  a literal reason. There is no baseline and no allowlist; the exception is the reason
  inside the `useRealClock` or `realClock` call.
- `.claude/rules/no-test-modifications.md` applies: a date-dependent failure is
  fixed by pinning the clock, not by loosening the assertion.

## Absence assertions

`queryBy…` with `not.toBeInTheDocument()`, `toBeNull()`, `toHaveLength(0)` or
`not.toHaveBeenCalled()` also passes against an empty render, a permanent
skeleton or renamed text. Permission and feature gates mostly rest on such
assertions, so each one needs a positive check (#4435):

1. **Anchor in the same render.** Before the absence check, assert an element
   only the loaded content renders: a neighbour entry of the same group, a
   list row, a mocked child of the loaded view. A page title, shell or tab bar
   counts only if the loading state does not render it; check the skeleton
   (for example `LOADING_TABS` in the student record skeleton) before you pick
   one. Each anchor block, one or more consecutive assertions, starts with a
   `// Anker: <what it proves>` line, so `grep "// Anker:"` finds every anchor.
   Take the anchor from the branch (view, role, mode) the gate hangs on. An
   element several views render proves only "loaded": the student record's
   `guardian-manager` renders in both the full and the limited view, so a gate
   of the full view anchors on `care-schedule-manager`, which only the full
   view renders.
2. **Counterpart.** Next to the test for the forbidden role or the switched-off
   feature, a test for the allowed role or switched-on feature finds the same
   element with the same query. Both take the same path (URL, filter, clicks)
   and differ only in the permission or setting. A label no counterpart can
   find is a dead check, usually left behind by a rename.
3. **Components that render nothing when hidden.** Keep the visible
   environments of the positive cases in the table. Each hidden row spreads
   the visible row it is checked against and overrides only what differs. It
   asserts absent, unmounts, resets state the first render changed (visit
   count, storage), renders the visible row and asserts present
   (`src/components/tenant/pwa-install-hint.test.tsx`).
4. **Countercheck once per file.** Temporarily let the component return `null`
   or stay in its loading state and run the absence tests. Each must fail, and
   the failure must come from the anchor assertion itself (its query in the
   error message), not from an unrelated line. Revert and record the result
   in the PR.
5. **`waitFor` waits for a positive state.** A `waitFor` whose callback only
   asserts absence passes on its first run, before asynchronous data arrives.
   Await the loaded content first (`await screen.findBy…`), then assert the
   absence synchronously. Keep `waitFor` for a transition: the element was
   asserted present, an action removes it, `waitFor` waits for it to go.

```tsx
render(<Sidebar />);

// Anker: die Staff-Navigation ist geladen.
expect(screen.getByText("Meine Gruppen")).toBeInTheDocument();
expect(screen.queryByText("Datenverwaltung")).not.toBeInTheDocument();
```

Enforcement: oxlint plugin `scripts/oxlint-plugin-absence-assertion.mjs`
(tested in `scripts/oxlint-plugin-absence-assertion.test.ts`) runs in
`pnpm run check` and CI. `absence-assertion/needs-anchor` rejects a test whose
only DOM assertions are absences; `getBy…`/`findBy…` calls, positive jest-dom
matchers and positive checks of a DOM node or its text count as evidence,
mock-call assertions do not. `absence-assertion/no-early-wait-for` rejects a
`waitFor` with an absence assertion before any positive DOM evidence. Evidence
counts from the test, the `beforeEach`/`beforeAll` hooks of its `describe`
blocks and same-file helpers it calls; imported helpers are opaque. The only
exception is the exact empty-render contract,
`expect(container.firstChild).toBeNull()`,
`expect(container).toBeEmptyDOMElement()` or
`expect(container.innerHTML).toBe("")`, for a component whose hidden state
renders nothing and that has no visible environment worth tabling. Empty text
(`container.textContent` is `""`) stays an absence, and
`not.toBeEmptyDOMElement()` is no anchor: a skeleton passes both. There is no
baseline or allowlist.

## Kit pixel comparison

`pnpm run kit-pixel` proves that a kit refactor changes nothing a user sees
(#6562, epic #6561). It renders every story under `src/components/ui/` at
desktop and phone width (`playwright.kit-pixel.config.ts`) and compares them
pixel for pixel, threshold zero, against a baseline of a chosen commit. Local
only; no CI job runs it. The same command checks touch targets
([below](#touch-targets)), which CI does run.

1. `pnpm run kit-pixel baseline --ref <commit>` (default `HEAD`). Exports the
   commit with `git archive`, so uncommitted edits stay out, builds Storybook
   from it and writes the images to `.kit-pixel/baseline/`. A failed run
   keeps the previous baseline.
2. Change the code.
3. `pnpm run kit-pixel compare` builds Storybook from the working tree. Done
   when it ends with „Keine Abweichung“. It also fails when a story of the
   baseline is gone (deleted or renamed). A deviation leaves expected, actual
   and `*-diff.png` under `.kit-pixel/results/`;
   `pnpm exec playwright show-report .kit-pixel/report` shows them side by side.

Options for both commands: `--filter <regex>` on the story id
(`components-ui-modal--default`; with a leading dash write `--filter=--opened$`),
`--all-stories` to include stories outside `ui/`. `compare` reuses the
baseline's selection unless given its own.

- A refactor ticket adds missing stories for the pieces it touches in its
  first commit, without code changes, and takes the baseline from that commit.
- Open states (menu, popover, picker) are stories with a `play` function that
  opens them. Templates: `OverflowMenu` and `ListboxDropdown` `Opened`
  (menu, list), `TenantPage` `InfoOpened` (popover).
  A modal story passes `isOpen`. The run waits for `play` to finish and fails
  the story when `play` throws: Storybook itself still reports success then.
- Fixed for stable images: the app fonts (`.storybook/fonts.css`, loaded
  before every render; a baseline from a commit before #6562 renders Arial),
  the Vitest instant `TEST_CLOCK_INSTANT` with running timers, Berlin time,
  reduced motion, no CSS transitions, CSS animations in zero time, CPU
  rendering. A running transition alone changed edge smoothing between runs.
  The build is served from disk via `page.route`: no port, no network.
- Chrome updates itself, and another build renders differently. The baseline
  records the version; `compare` refuses a different one. Take a new baseline
  then.

### Touch targets

`pnpm run kit-pixel touch` checks the finger rule of #8059 on every kit
story (#8060): under `pointer: coarse` each control (`button`, `a[href]`,
`input`, a `label` around a checkbox or radio, `role` button, link,
menuitem, option, tab, checkbox, radio, switch) needs a 44 px hit area,
and two hit areas must not overlap. It runs only in the `phone` project
(Pixel 7, touch), in two widths: phone and iPad portrait (820 px), where
sizes tied to `max-sm:` do not apply. The desktop project does not run it.
CI runs it in „Frontend quality“ on the Storybook build of that job.

- Measured with `elementFromPoint`, as the browser assigns a tap, so
  `after:` areas and padding with negative margin count. A circle of 44 px
  around the centre (radius 21.5 px, sampled every 4 px; Chrome rounds the
  point) must hit only the element; Chrome leaves out rounded corners, so a
  square would fail every round 44 px button. Overlap: a point another
  control takes that this element would also take
  (`scripts/kit-touch-targets-measure.ts`).
- Not checked: hidden, `disabled` or `inert` controls, controls under an
  open menu or dialog, full-screen backdrops, links inside running text,
  labels of text fields (the field is the target), browser-drawn inputs
  (file, range, color).
- Known violations: `scripts/kit-touch-targets-known.json`, per story and
  width. The list only gets shorter: a new violation fails, and so does an
  entry that no longer occurs. Fix a new violation; never add it. The
  tickets of #8059 empty the list.
- Permanent exceptions: `scripts/kit-touch-targets-exceptions.mjs`, each
  with a reason. `kit-ausnahme` for the deliberate exceptions of the
  [finger rule](../../.claude/rules/frontend-ui-kit.md#buttons);
  `abstand-24` for an element with at least 24 px clearance to every other
  control because 44 px would break the layout. The check measures that
  clearance; when it shrinks, the exception no longer applies.
- Measurements per story land in `.kit-pixel/touch/`. Each story and width
  loads a fresh page from a server of the worker on 127.0.0.1 (no
  `page.route`, so the browser cache holds the build): switching stories
  over Storybook's channel carried state into the next story. Locally the
  run took 58 s on 12 cores (about 250 CPU seconds); `--filter` narrows it
  like the pixel comparison, `--storybook-dir` reuses a finished build.
- Both runs ignore axe findings: they render at widths where
  `pnpm run test:storybook` does not run axe (412 px, 820 px), and axe stays
  that test's job. A render error or a failing `play` still fails.

## Storybook tests and a11y

`pnpm run test:storybook` renders every story in Chromium
(`vitest.storybook.config.ts`, `@storybook/addon-vitest`) and runs its `play`
function and the axe check of `@storybook/addon-a11y` (#7108). A render
error, a failing `play` or an axe violation fails the story.
`.storybook/preview.tsx` sets `a11y.test: "error"` for all stories.

- CI runs the job „Storybook tests“ in three shards on hosted runners
  (`scripts/storybook-test-changed.mjs`, `STORYBOOK_SHARD=1/3`). The full
  run is CPU-bound and costs about 220 s on one 4-core runner, three
  quarters of it the fresh iframe every file gets; more workers and
  `isolate: false` were measured and rejected (#6962). A pull request
  tests the stories whose imports it changes (`vitest related`); a change
  to the global
  inputs in `GLOBAL_INPUTS` (`.storybook/`, its providers, styles,
  `public/`, dependencies, the config) runs all stories, as do pushes and
  the nightly run. Copy in `src/i18n/messages` is deliberately not a
  trigger: it changes in about a quarter of frontend PRs, so the push and
  nightly runs check it. Locally the full run took about
  100 s on 16 cores; a selection `pnpm exec vitest related --run -c
  vitest.storybook.config.ts <files>`.
- A story with known violations sets `parameters: { a11y: { test: "todo" } }`
  with a comment above it: `// axe meldet hier noch <Regeln>; Behebung in
  #<Issue>.` (contrast #7110, names and semantics #7112).
  `scripts/storybook-a11y.node-test.mjs` fails an exception without an issue.
  Remove the exception when the issue fixes the story; never add one to make
  a new story pass.
- A story that leaves the page (a real `redirect()`) carries
  `tags: ["!test"]`; it would close the test browser.
