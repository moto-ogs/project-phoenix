---
paths:
  - "backend/**/*.go"
  - "frontend/src/**/*.ts"
  - "frontend/src/**/*.tsx"
---

# Copy or link: show whether data follows its source

**RULE: Where a target takes data from a source, the screen shows whether
the target follows the source.** A target that follows is a **link**. A
target taken over once is a **copy**. When a copy stands where the person
expects a link, the screen says so and offers the link.

Why: at Schule am Berg, cancellations from the bookings never reached the
Randstunden-Regeltermine. The children had been taken over once through the
target „Klasse“, and a copied roster looked exactly like a linked one
(#5102–#5104, #5133). Nothing failed. The person simply could not see that
the data stood still.

## Decide

Answer three questions for every transfer before you build it:

1. **Copy or link?** A link keeps one authoritative source and follows its
   changes: a read-time join, a resync or a cascade in the same transaction
   ([information flow](information-flow.md), point 4). A copy is right when the
   target must stay as it was: an issued invoice, a sent message, a signed
   contract, a closed payroll month, an import, or a new phase that is planned
   on its own.
2. **What happens when the source changes?** Follow edit, delete, cancellation,
   withdrawal, a new entry, the school-year change and the phase rollover.
   Each one either reaches the target or is deliberately absorbed by the
   copy. Ids that point into a source are remapped when the source is cloned
   (rollover, split, convert).
3. **What does the person expect?** A target named after a living set
   („Klasse 3a“, „Gruppe Füchse“, „Angebot Frühbetreuung“) reads as a link.
   If it is a copy, the screen has to say so.

## Make it visible

The Regeltermin is the reference pattern (#3140, #5110–#5112, #5181):

| Where | What the person sees | Reference |
|---|---|---|
| At the target | Its state as a label with an icon, plus the source by name: „Automatisch“, „Teils automatisch“, „Manuell“ | `frontend/src/lib/roster-maintenance.ts` |
| At a copy that differs from the source | What differs, and two equal choices: link it or keep it as it is | `frontend/src/components/timetable/roster-deviation-hint.tsx` |
| At the source, when it changes | Which targets followed and which did not, and why | `frontend/src/components/students/care-plan-impact.tsx` |
| When creating the target | The matching source is suggested before a copy is made | `frontend/src/components/timetable/event-form/step-personal-kinder.tsx` |

- A frozen record names its moment: „Stand vom …“, „Gezählt werden die Eltern
  der Kinder, die die Mitteilung am … erreicht hat“.
- A source that ends (deleted group, withdrawn permission, ended phase)
  either ends its links or leaves a visible note at each target. Leaving an
  open link to nothing is a defect.
- Copy and labels follow [Verständlichkeit](verstaendlichkeit.md) and
  `moto-einfache-sprache`. Colour is never the only cue.

## Proof

Before calling the change done, change the source once in a test or in the
running app (edit, cancel, delete) and check the target. Either the target
follows, or the screen names the copy. A gap you do not fix gets a follow-up
issue that names the source, the target and what the person sees.
