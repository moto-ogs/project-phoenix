---
name: ui-before-after
description: Use when a UI change needs before/after screenshot pairs for a PR or review, with the changed regions outlined and numbered. Triggers on "vorher/nachher", "before/after screenshots", "circle what changed", visual comparison of a frontend refactor, or verifying that a migration did not change the look.
metadata:
  author: moto-ogs
  version: "1.3.0"
---

# Before/After UI Screenshot Pairs

Capture the same interactions against two pinned source states, verify the
rendered state before each screenshot, outline what changed, and composite
matched pairs.
Turbopack can serve stale modules after a source switch. Hot reload alone does
not establish which state the browser shows.

## Prerequisites

- Start from a clean working tree with the UI changes committed. Record the
  original branch/commit and pin the baseline to a commit with `git rev-parse`.
  Keep unrelated changes and untracked files intact; if they overlap the paths
  to switch, use a separate prepared checkout instead of overwriting them.
- Read [native dev loop](../../../../docs/agents/operations.md#native-dev-loop).
  Record the actual frontend start command, mode, port, working directory and
  process ownership before switching sources. If another task uses this source
  tree or the frontend cannot be restarted safely, move the comparison into a
  separate prepared checkout with its own port and cache **before any switch**.
  Use the existing mode throughout. Bootstrap only the services the shot list
  needs; preserve the database.
- Use local seeded credentials from the seed state, without copying them into
  documentation, logs or screenshots. Complete any MFA through local Mailpit.
- Use a dedicated `agent-browser --session <name>` session. Capture each changed
  surface at **desktop (1440×900)** and **mobile (390×844)**. Before reproducing
  the interactions at each size, set `agent-browser --session s set viewport
  1440 900` or `agent-browser --session s set viewport 390 844` respectively.
  Match dimensions within each before/after pair; prefix filenames with
  `desktop-` or `mobile-` so both pairs remain identifiable.

## Source-state gate (every switch, including final restoration)

1. **Stop, clear `.next`, then restart the responsible frontend** after the
   target sources are on disk. Use the recorded mode after **every** switch:
   baseline, branch and final restoration. Stop only task-owned processes after
   checking their command and checkout; confirm the old listener has exited
   before removing this checkout's task-owned `frontend/.next` and starting its
   replacement on the same port. Verify `.next` is not a symlink or shared cache.
   - With `scripts/dev-native.sh up [backend|frontend]`, retain the original
     selection. Every `up` replaces **both** managed apps and stops the Compose
     app containers. Use it only when all affected apps belong to this task.
     `down` also stops both apps, not just the frontend. It waits for the
     captured process trees to exit after TERM, with a ten-second limit. A
     timeout returns an error, so the `&&` chain below leaves the cache intact
     and skips the restart. No separate wait is needed after a successful `down`.
     From the repository root, after the ownership/listener checks:
     ```bash
     scripts/dev-native.sh down &&
       test ! -L frontend/.next &&
       rm -rf -- frontend/.next &&
       scripts/dev-native.sh up frontend  # use `up` if both apps were selected
     ```
   - For a task-owned foreground frontend launched through
     `scripts/dev-native.sh frontend <command...>`, stop that command gracefully
     (including its children), clear the same `.next` directory while stopped,
     then repeat the exact command with the same port and environment, e.g.
     `scripts/dev-native.sh frontend pnpm dev`. This command wrapper does not
     need an `up`/`down` cycle and leaves independently managed apps alone.
   - If ownership has changed since preflight, return to the prerequisites and
     isolate the checkout before continuing. Never kill a listener just because
     it occupies the desired port.
   Restart **and** fresh `.next` are required; hot reload or a browser reload
   does not replace either step. Never delete shared caches or data.
2. **Check the rendered target, not just server readiness.** Open the URL, wait
   for the expected page/interaction state, then take a fresh snapshot. For a
   visible change, assert the target-specific text, styling or element and the
   absence of the other state's distinguishing feature. Inspect the image when
   appearance, rather than text, is the distinction.
   For example, adapt this DOM assertion to the shot's real selector and texts:
   ```bash
   agent-browser --session s wait --fn 'document.querySelector("h1")?.innerText === "Expected target heading" && !document.body.innerText.includes("Other state heading")'
   ```
   Require a successful assertion before running `screenshot`; a timeout or
   mismatch blocks that shot. Record the assertion and observed value.
   For claimed visual equality, use an explicit target-specific rendered marker
   tied to the pinned commit (a temporary verification-only label outside the
   comparison region, recorded separately). Remove it during final restoration;
   never commit it as product code. A startup message, fixed sleep, browser
   reload, successful HTTP response or clean Git status alone is not proof.
3. **Record evidence**: expected ref/commit, switched paths, restart/reset command,
   old/new process identity, URL, rendered assertion and screenshot filename.
   Apply the rendered check before **each** screenshot, after reproducing its
   interactions. If the expected state cannot be established, stop capturing
   and investigate; do not label the image as before/after.

## Workflow

1. **Plan the shot list.** List URLs, exact interactions and required data for
   each surface and viewport. Choose a rendered-state assertion for each target
   before switching. Create needed data once; use the same data and interactions
   throughout both passes, matching the viewport within each pair. Write the
   numbered change list of [Mark what changed](#mark-what-changed) and note per
   shot which numbers it shows.
2. **BEFORE:** restore only the comparison paths from the pinned baseline into
   the working tree, leaving the index at the branch state:
   ```bash
   git restore --source=<baseline-sha> --worktree -- frontend/src
   ```
   Inspect added/deleted paths too: branch-only files must not leak into the
   baseline. If dependencies or configuration differ, include those inputs in
   the plan or use isolated checkouts; swapping `src` alone is not equivalent.
   Run the source-state gate, then walk the shot list at **both viewports**.
   Set the size before opening the URL and reproducing its interactions; take
   fresh refs after resizing. Use `desktop` or `mobile` for `<viewport>`:
   ```bash
   agent-browser --session s open <url>
   agent-browser --session s snapshot -i -c
   agent-browser --session s click @eN
   # Re-snapshot and verify the target-specific rendered assertion here.
   agent-browser --session s screenshot shots/before/<viewport>-<nn>-<name>.png
   ```
   Where the shot shows a region the branch removes, add its marked twin under
   `shots/before-marked/` ([Mark what changed](#mark-what-changed)).
3. **AFTER:** restore the comparison paths from the recorded branch commit:
   ```bash
   git restore --source=<branch-sha> --worktree -- frontend/src
   ```
   Run the source-state gate again. Repeat the same URLs and interactions at
   **both viewports**, verifying the branch assertion before each image. Use
   identical viewport-prefixed filenames under `shots/after/`, and the marked
   twin of every shot with a visible change under `shots/after-marked/`.
4. **Composite pairs** with ImageMagick, left=before and right=after, taking
   the marked twin of a side where one exists. Use a task-owned output
   directory and unique temporary filenames:
   ```bash
   for f in shots/before/*.png; do
     n=$(basename "$f")
     b="shots/before-marked/$n"; [ -f "$b" ] || b="$f"
     a="shots/after-marked/$n"; [ -f "$a" ] || a="shots/after/$n"
     magick "$b" -resize 50% -bordercolor gray -border 1 "shots/b-$n"
     magick "$a" -resize 50% -bordercolor gray -border 1 "shots/a-$n"
     magick "shots/b-$n" "shots/a-$n" +append "shots/pair-$n"
   done
   ```
5. **Restore even after failure.** Remove only task-created verification markers
   and restore all switched paths to the original branch commit. Run the same
   source-state gate one last time and verify the original UI is rendered and
   temporary markers are absent. Check `git status --short` against the initial
   state as a separate source check. Then close the dedicated browser session
   and stop task-owned services no longer needed. Preserve pre-existing
   services, databases, volumes and caches; record anything left running.
6. **Deliver** the inspected pairs with the ref/restart/rendered evidence and,
   beside each marked pair, the change-list lines of the numbers it shows. Post
   native PR attachments as described in
   [PR screenshots and QA evidence](../../../../docs/agents/operations.md#pr-screenshots-and-qa-evidence).

## Mark what changed

A pair with a visible change carries numbered red outlines, so a reviewer finds
the changed regions at a glance. A pair that proves "no visual change" stays
unmarked.

- **Change list.** Number every visible change the PR names and give each one
  line a reviewer can check against the image („2: Speichern steht am Ende der
  Karte“). A number keeps its meaning across all shots and both viewports.
- **Which side.** Outline added, moved and restyled regions on the after image,
  removed regions on the before image. A rebuilt card gets one outline around
  the card.
- **Draw, then shoot again.** Keep the clean screenshot. With the page still in
  the asserted state, draw the marks and save the twin under the same filename.
  From the repository root:
  ```bash
  { cat frontend/.claude/skills/ui-before-after/mark-changes.js
    echo 'markChanges([[1, "[data-testid=save-bar]"], [2, "main section:nth-of-type(3)"]])'
  } | agent-browser --session s eval --stdin
  agent-browser --session s screenshot shots/after-marked/<viewport>-<nn>-<name>.png
  ```
  Each entry is `[number, CSS selector]`; the first match is outlined. Scroll a
  region inside an inner scroll area into view first. An evaluation error
  (selector matches nothing, element invisible) blocks the marked shot like a
  failed rendered assertion.
- **Inspect the twin.** Every outline surrounds its region, and outline and
  number cover no changed content; choose a wider or narrower selector until
  both hold.
- **Clear before going on.** The marks exist only in the open page. Navigation
  removes them; to keep interacting on the same page, call `markChanges([])`.

## Interaction notes

- Browser element refs go stale after navigation or re-render. Take a fresh
  `snapshot -i -c` before interacting; a reported successful fill is not proof
  the expected state was reached.
- Capture menus/popovers open, then press Escape before navigating onward.
- Empty states are often reachable by searching gibberish (`xyznichts`).
- Keep data unchanged between passes. Relative timestamps may differ; record
  that limitation rather than altering records to make the images match.
