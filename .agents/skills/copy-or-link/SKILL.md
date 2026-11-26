---
name: copy-or-link
description: Use when designing or reviewing a feature that takes data from a source into a target - rosters from bookings, classes or groups, templates, copies, rollovers, imports, applied parent requests, Träger data pushed to schools. Asks „Kopie oder Verbindung?“.
metadata:
  author: moto-ogs
  version: "1.0.0"
---

# Kopie oder Verbindung?

Applies [the copy-or-link rule](../../../.claude/rules/copy-or-link.md) while
a feature is still being designed. Read the rule first. It holds the three
questions, the reference pattern and the proof.

## Steps

1. **List every transfer.** Name each pair of source and target, with the
   code path that moves the data, including the ones the feature only
   triggers: rollover, split, import, school-year change. Done when every
   field the target shows has a named source or is marked as its own data.
2. **Answer the three questions per transfer** from the rule: copy or link,
   source change, the person's expectation. Cite code for the answer, not the
   function name. Done when each transfer has one answer per question, and
   every source event from the rule (edit, delete, cancellation, withdrawal,
   new entry, school-year change, rollover) is either followed or deliberately
   absorbed.
3. **Choose the visible state** for each transfer from the rule's table:
   the label at the target, the hint where a copy differs, the impact at the
   source, the suggestion at creation. Write the German wording with
   `moto-einfache-sprache`. Done when each transfer has its wording or the
   reason it needs none (a pure read-time join the person cannot tell apart).
4. **Record the result** in the PR body under a short „Kopie oder Verbindung“
   list: one line per transfer with the answer and the visible state. For a
   gap you leave, open a follow-up issue (source, target, what the person
   sees, suggested fix) and link it there.
5. **Prove it** as the rule describes: change the source once and check the
   target.
