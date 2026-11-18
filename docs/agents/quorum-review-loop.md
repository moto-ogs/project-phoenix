# PR review and merge

When implementation and merge are authorized, that authorization includes the
implementing delegate. The implementer can merge once the selected review and
the merge checks below are complete.

## Choose review depth

Self-review the PR diff against its base. Confirm it matches the requested
scope, trace the affected callers and failure paths, and check that verification
covers the behavior that could break. Choose review depth from the impact of a
mistake and the evidence from self-review. Line count alone never selects a path.

- **Direct merge.** For a small, low-risk change whose effects you understand,
  proceed after self-review if you can account for its affected behavior and
  have no material uncertainty.
- **One focused delegate.** For an otherwise low-risk change with a concrete
  material uncertainty, give one independent reviewer the PR head, the specific
  question, and the evidence to check. Resolve their findings and verify the
  fixes before merging. If material uncertainty persists or the review uncovers
  broader risk, use Quorum or leave the PR open with the blocker.
- **Quorum.** Use the full loop for high-risk or broad changes, or when explicitly
  requested. Changes to tenant isolation, authorization, or production data
  migrations can warrant Quorum even with a short diff.

## Before merging

Before merging, fetch the PR's base and check mergeability. Fetching updates
remote references. Update the branch only for actual conflicts (`DIRTY`), when
the PR adds or changes migrations, or when GitHub requires an update.
`BASE_UPDATE=conflicts` does not cover the migration case: merge the base
yourself, so the name check and the order check of
[the migration system](backend-data.md#migration-system) run against the
migrations merged since. For stacks, follow the
[stacked-PR workflow](../../.agents/skills/stacked-pr/SKILL.md#keep-the-stack-current).
Check relevant interactions with recent base changes; investigate concrete
integration risks without routine sync commits.

For every path, merge only with authorization, a ready and conflict-free PR,
completed review and passing required local checks and CI on its current head,
and all review blockers resolved.
Resolve unknown mergeability and blocked checks before merging. Follow GitHub's
branch protections, including any required approvals and merge queue.

Bind ordinary merges to the reviewed and checked head with
`gh pr merge --match-head-commit <SHA>`. For stacks, pass that head as `sha`
to the [asynchronous merge endpoint](../../.agents/skills/stacked-pr/SKILL.md#merge).
If the head changes, reassess review depth, review the new revision, and rerun
the affected checks before retrying. Confirm the merged state and report it
to the orchestrator for tracking.

## Quorum review loop

Run `BASE_UPDATE=conflicts quorum babysit <pr-number>` to avoid routine base
updates when the branch is behind. Keep Quorum's review/fix loop and stopping
conditions. Let the loop finish without a rounds cap. Request further review
for a concrete unresolved concern or an explicit user requirement.

## Local test gate and CI

[`.quorum/testcmd`](../../.quorum/testcmd) sets the local gate to
`scripts/run-go-toolchain.sh scripts/test-changed.sh --fast`. The wrapper pins
the Devbox Go toolchain even when Quorum runs outside a Devbox shell.
For backend changes, `--fast` selects changed packages and direct importers,
plus affected source checks from `./test` using an anchored `-run` filter.
The filesystem-input inventory is in
[`scripts/backend-source-ratchets.mjs`](../../scripts/backend-source-ratchets.mjs),
including checks without `Ratchet` in their name. Selection includes committed,
staged, unstaged and untracked paths, both sides of renames and deleted inputs.
Source checks use `-count=1`; ordinary package tests retain their cache and
receive no `-run` filter. A full `./test` selection runs once, without a filter.
The fast path does not expand transitive importers or run the full `./test`
database suite for every backend edit. Runtime schema checks stay in that suite.
Changes to `go.mod` or `go.sum` still select all backend packages. Frontend
selection is unchanged. CI keeps the full affected closure, including test
importers and ratchets; the manual full run remains available:

```bash
scripts/run-go-toolchain.sh scripts/test-changed.sh origin/development
```

Quorum resolves `--test-cmd` first, then the user-local
`~/.config/quorum/testcmd/<owner>/<repo>`, then the repo file **from the base
branch**, not the PR head. Check for a local override before relying on this
gate. To verify a gate change before it merges, pass the command explicitly:

```bash
BASE_UPDATE=conflicts quorum babysit <pr-number> --test-cmd 'scripts/run-go-toolchain.sh scripts/test-changed.sh --fast'
```

With a shared admission gate such as `~/bin/agent-heavy`, wrap only the
`--test-cmd`, never `quorum babysit` itself. The loop mostly waits for reviews
and holds an outer slot for its whole lifetime; a nested gate call inherits that
slot. On 31 October 2026 one wrapped babysit loop held one of two slots 28 % of
38 sampled minutes at about one CPU second per minute, while other agents
queued up to 490 s for test runs.

The existing package-worker budget and `-parallel 8` remain unchanged.
Concurrent sessions add their load against the same test server; the run-ID
lock prevents clone-name collisions, not concurrent DB load. A smaller gate
does not prove that DB timeouts are fixed. For a bounded before/after load
check, record concurrent runs, selected packages, flags, server port, elapsed
time and failures. Separate server I/O, SQL waits and pool waits before adding
throttling. Follow the [test-server lifecycle](operations.md#test-database)
and preserve other sessions and persistent data during cleanup.

Make an overloaded gate pass by making tests cheaper: reshape, merge or thin
them while their assertions hold
([test-contract rule](../../.claude/rules/no-test-modifications.md)). Test
deadlines, retries, dropped `t.Parallel()` and weaker assertions hide the load
instead of removing it.
