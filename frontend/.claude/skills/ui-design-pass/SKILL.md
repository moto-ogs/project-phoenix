---
name: ui-design-pass
description: Design pass over one new or existing screen, with a blind two-model review loop scored against a reference screen. Runs when a person asks for it by name.
disable-model-invocation: true
metadata:
  author: moto-ogs
  version: "1.1.0"
---

# UI design pass

One screen per run. The person names the mode with the skill:

- **`new`**: the task at hand creates UI. Run this pass on that UI.
- **`rework <screen>: <what bothers them>`**: an existing screen. Rearrange and
  regroup what exists; behaviour and data stay the same.

Ask once when the screen or the mode is missing. A rework without a stated
complaint starts from your own diagnosis in step 2.

**Goal:** someone who does this task every day finishes it faster and with
fewer wrong clicks.

[`.claude/rules/frontend-ui-kit.md`](../../../../.claude/rules/frontend-ui-kit.md)
outranks this skill. Build from the kit only; propose a missing piece in the PR
instead of inlining it.

## 1. Set the bar

Read the kit rule and
[`.claude/rules/verstaendlichkeit.md`](../../../../.claude/rules/verstaendlichkeit.md).
Open the nearest reference screen the kit rule names and two or three recently
merged UI PRs by `theitger` (`gh pr list --author theitger --state merged`).

Done when you can name the reference screen and the PRs you compared against.
The reference screen is also the yardstick in step 5.

## 2. Diagnose before editing

- **`new`**: write down who uses the UI, what they came to do and their steps
  in order. Find the closest existing screen and reuse its structure.
- **`rework`**: open the screen in the running app on desktop and phone. Write
  down the task, the steps in order and the three worst problems. Fix those
  first.

If the real problem is the flow between screens, say so before polishing one
screen.

Done when the steps and, for a rework, the three problems are written down.

## 3. Design

**Cheapest fix first.** A better name or one explaining line often beats a new
layout. Try that before you restructure.

**Layout**

- Order follows the task: what is needed first comes first, the finishing
  action sits at the end.
- Group related things in one `SectionCard` with a heading that names it.
  Separate groups with spacing, not more boxes.
- One main thing and one primary action per view. Rare and row-level actions
  go into the `OverflowMenu`.
- Frequent actions keep their place unless moving them clearly helps. Daily
  users act from memory.
- Visual order equals DOM order, so keyboard and screen reader follow the eye.
- Fold what most visits do not need into a collapsible `SectionCard`, closed
  by default and one level deep. What a role needs every day stays visible.
- Sidebar, only when the task adds or moves a navigation entry: related
  entries go under one section as sub-entries, the top level stays short.
- Remove what changes no decision.

**Delight, inside the kit**

- The finishing action names its outcome.
- After it comes a confirmation of what happened and what comes next. A
  finished step shows a result state.
- Empty, loading, error and disabled states get the same care as the filled
  one.
- Finish the small things: aligned edges, even spacing, concept icons, real
  figures instead of filler.

**What moves with the screen.** Whatever you move or rename may be referenced
elsewhere: guided tours (`data-setup-tour`), help articles and their
screenshots, tooltips, tests, and every language catalog of a translated
portal. Update them in the same PR.

## 4. Stress it

- No data, one entry, very many entries, the longest names and words. Also at
  360 px width.
- As the least privileged role that uses the screen, not only as admin.

Done when every case above has been looked at in the running app.

## 5. Climb to the reference score

Reviewers are independent and blind: fresh each round, on two different models
where the harness offers them (one Claude, one GPT/Codex). They get the packet
below and nothing else: no reasoning for your design, no earlier scores.

**Rubric**, each criterion 1 to 10: task order · hierarchy and grouping · fits
the kit and neighbouring screens · cannot be misread · finish and delight.

**Target.** A blind reviewer's scale is not calibrated, so the target is
measured: the score the same reviewer gives the reference screen from step 1 in
the same round, capped at 9.5. Capture the reference screen in the running app
like your own.

**Packet** for every round:

- Screenshots at 1440×900 and 390×844 of every state you designed, and the same
  of the reference screen, labelled only by screen name.
- For a rework, the images of the screen before your change.
- The two rule files and the rubric.
- **Scope:** one or two lines naming what this task may change. Everything else
  visible in the images (shared components, other screens, behaviour a rework
  must keep) is out of scope: reviewers list such findings separately and leave
  them out of the score.
- **Decided:** from round 2 on, every point you declined or settled, each with
  its reason (kit rule, ADR, issue). A reviewer who reopens one names the rule
  or the harm to the user that outweighs that reason.

Each reviewer scores both screens on every criterion, names the three in-scope
changes that would raise your screen's score most, and names anything that got
worse or went missing.

1. **Baseline**, rework only: both reviewers score the screen before your
   change with the same packet. A baseline within one point of the reference
   means the rubric cannot tell the two apart: say so in the PR.
2. **Round.** Send the packet, then apply the feedback. Precedence: kit rules,
   then the issue's acceptance criteria, then reviewers. A point you decline
   goes on the Decided list.
3. Repeat step 2 until each reviewer's average for your screen reaches the
   target and no criterion sits more than one point below the reference's.
   After two rounds without gain, stop and report the gap.

## 6. Hand over

- Click through the whole flow, including an error case and keyboard only.
- `cd frontend && pnpm run check` with zero warnings, plus the affected tests.
- Screenshots: for a rework, before/after pairs from the `ui-before-after`
  skill, desktop and phone, with the changed regions marked. For new UI, one
  image per designed state (empty, filled, error, success), desktop and phone.
- The PR body carries the baseline, both screens' scores per round, the
  Decided list, the out-of-scope findings as follow-up candidates, and what
  you folded, moved or removed with the reason you believe it is rarely
  needed.
