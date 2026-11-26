"use client";

// Wer das Kind an einem Tag abholt (#7655): eine schon abholberechtigte
// Person oder eine einmalige Person mit Namen. Bei der einmaligen Person
// speichert moto nur den Namen; das Personal prüft beim Abholen den Ausweis.
import { UserCheck } from "lucide-react";
import { Button } from "~/components/ui/button";
import { IconTile } from "~/components/ui/icon-tile";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Input } from "~/components/ui/input";
import type { GuardianWithRelationship } from "~/lib/guardian-helpers";
import type { DayData as PickupDayData } from "~/lib/pickup-schedule-helpers";

/** Höchstlänge des Namens, wie im Backend. */
const NAME_MAX_LENGTH = 120;

/** "regular", "name" oder "contact:<id>". */
export interface PickupPersonDraft {
  readonly choice: string;
  readonly name: string;
}

export type PickupPersonSubmit =
  | { kind: "regular" }
  | { kind: "contact"; guardianProfileId: string }
  | { kind: "name"; name: string };

export function pickupPersonInitialState(
  day: PickupDayData | null,
): PickupPersonDraft {
  const person = day?.pickupPerson;
  if (!person) return { choice: "regular", name: "" };
  if (person.guardianProfileId) {
    return { choice: `contact:${person.guardianProfileId}`, name: "" };
  }
  return { choice: "name", name: person.name };
}

export function pickupPersonChanged(
  draft: PickupPersonDraft,
  initial: PickupPersonDraft,
): boolean {
  if (draft.choice !== initial.choice) return true;
  return draft.choice === "name" && draft.name.trim() !== initial.name.trim();
}

/** null: eine einmalige Person ohne Namen, das Speichern wartet. */
export function toPickupPersonSubmit(
  draft: PickupPersonDraft,
): PickupPersonSubmit | null {
  if (draft.choice === "regular") return { kind: "regular" };
  if (draft.choice.startsWith("contact:")) {
    return {
      kind: "contact",
      guardianProfileId: draft.choice.slice("contact:".length),
    };
  }
  const name = draft.name.trim();
  return name ? { kind: "name", name } : null;
}

/** Kontakte, die das Kind an diesem Wochentag abholen dürfen. */
function pickupContacts(
  guardians: readonly GuardianWithRelationship[],
  weekday: number,
): GuardianWithRelationship[] {
  return guardians.filter(
    (guardian) =>
      guardian.canPickup &&
      (!guardian.pickupWeekdays || guardian.pickupWeekdays.includes(weekday)),
  );
}

export function CarePickupPersonSection({
  pickupDay,
  draft,
  onDraftChange,
  guardians,
}: {
  readonly pickupDay: PickupDayData;
  readonly draft: PickupPersonDraft;
  readonly onDraftChange: (draft: PickupPersonDraft) => void;
  readonly guardians: readonly GuardianWithRelationship[];
}) {
  const contacts = pickupContacts(guardians, pickupDay.weekday);
  const stored = pickupDay.pickupPerson;
  const options: Array<readonly [string, string]> = [
    ["regular", "Wie immer"],
    ...contacts.map(
      (contact) =>
        [
          `contact:${contact.id}`,
          `${contact.firstName} ${contact.lastName}`.trim(),
        ] as const,
    ),
  ];
  // Eine gespeicherte Person, die heute nicht mehr in der Liste steht,
  // bleibt wählbar, damit der Tag nicht still verloren geht.
  if (
    stored?.guardianProfileId &&
    !options.some(([value]) => value === `contact:${stored.guardianProfileId}`)
  ) {
    options.push([`contact:${stored.guardianProfileId}`, stored.name]);
  }
  options.push(["name", "Andere Person"]);

  return (
    <InsetPanel as="section" tone="white" padding="md">
      <div className="mb-3 flex items-start gap-3">
        <IconTile
          size="sm"
          icon={<UserCheck className="h-[18px] w-[18px]" aria-hidden />}
        />
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Wer holt ab?</h3>
          <p className="text-xs text-gray-500">
            Nur für diesen Tag. Wie immer: wer sonst abholt.
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(([value, text]) => (
          <Button
            key={value}
            type="button"
            size="md"
            variant={draft.choice === value ? "primary" : "outline"}
            className="w-full justify-start"
            noTooltip="Wählt nur eine Möglichkeit, gespeichert wird erst mit „Speichern“."
            onClick={() => onDraftChange({ ...draft, choice: value })}
          >
            {text}
          </Button>
        ))}
      </div>
      {draft.choice === "name" ? (
        <div className="mt-3 space-y-1">
          <Input
            id="exception-pickup-person-name"
            label="Vor- und Nachname"
            controlSize="compact"
            type="text"
            value={draft.name}
            onChange={(event) =>
              onDraftChange({ ...draft, name: event.target.value })
            }
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
          />
          <p className="text-xs text-gray-500">
            Prüf beim Abholen den Ausweis. Der Name wird nach dem Tag gelöscht.
          </p>
        </div>
      ) : null}
    </InsetPanel>
  );
}
