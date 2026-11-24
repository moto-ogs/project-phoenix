"use client";

// Name, Beschreibung und „Gilt als“ einer Träger-Rolle (#4810), im Dialog
// zum Anlegen und in der Karte zum Ändern. Die Rechte wählt die Karte
// darunter (`PermissionPicker`).

import { ChoiceTile } from "~/components/ui/choice-tile";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { Input } from "~/components/ui/input";
import { Radio } from "~/components/ui/radio";
import { Textarea } from "~/components/ui/textarea";
import { SYSTEM_ROLE_LABELS } from "~/lib/role-labels";
import type {
  TraegerSchoolRoleBase,
  TraegerSchoolRoleInput,
} from "~/lib/traeger-school-roles-api";

/** Name, Beschreibung und „Gilt als“; die Rechte führt der Aufrufer. */
export type SchoolRoleMasterDraft = Omit<
  TraegerSchoolRoleInput,
  "permissionIds"
>;

export const EMPTY_SCHOOL_ROLE: SchoolRoleMasterDraft = {
  name: "",
  description: "",
  baseRole: "user",
};

/** Prüft den Entwurf wie der Server; leer heißt gültig. */
export function schoolRoleDraftErrors(
  draft: SchoolRoleMasterDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.name.trim() === "") {
    errors.name = "Bitte gib einen Namen ein.";
  }
  return errors;
}

/** „Betreuung“ oder „Verwaltung“, wie die Schule es unter „Gilt als“ liest. */
export function schoolRoleBaseLabel(baseRole: TraegerSchoolRoleBase): string {
  return SYSTEM_ROLE_LABELS[baseRole].name;
}

const BASE_ROLES: readonly TraegerSchoolRoleBase[] = ["user", "admin"];

/** Was „Gilt als“ für die Personen mit der Rolle heißt. */
const BASE_ROLE_MEANING: Record<TraegerSchoolRoleBase, string> = {
  user: "Für Personen, die Kinder betreuen.",
  admin: "Für Personen, die die OGS organisieren.",
};

/** Die Vorauswahl der Rechte, die eine neue Rolle bekommt. */
const BASE_ROLE_START: Record<TraegerSchoolRoleBase, string> = {
  user: "Startet mit den Rechten der Betreuung.",
  admin: "Startet mit allen Rechten der Verwaltung.",
};

export function SchoolRoleFields({
  idPrefix,
  draft,
  onChange,
  fieldError,
  disabled = false,
  creating = false,
}: Readonly<{
  idPrefix: string;
  draft: SchoolRoleMasterDraft;
  onChange: (draft: SchoolRoleMasterDraft) => void;
  fieldError: (field: string) => string | undefined;
  disabled?: boolean;
  /** Beim Anlegen bestimmt „Gilt als“ auch die Rechte, mit denen die Rolle startet. */
  creating?: boolean;
}>) {
  const set = (patch: Partial<SchoolRoleMasterDraft>) =>
    onChange({ ...draft, ...patch });
  return (
    <div className="space-y-4">
      <Input
        controlSize="compact"
        id={`${idPrefix}-name`}
        name="name"
        label="Name"
        required
        maxLength={100}
        placeholder="z. B. Springerkraft"
        hint="So heißt die Rolle an allen deinen Schulen."
        value={draft.name}
        disabled={disabled}
        error={fieldError("name")}
        onChange={(event) => set({ name: event.target.value })}
      />
      <Textarea
        id={`${idPrefix}-description`}
        name="description"
        label="Beschreibung"
        rows={2}
        maxLength={500}
        placeholder="Wofür ist die Rolle gedacht?"
        hint="Die Schulen lesen sie neben dem Namen."
        value={draft.description}
        disabled={disabled}
        error={fieldError("description")}
        onChange={(event) => set({ description: event.target.value })}
      />
      <FormFieldset
        legend="Gilt als"
        required
        hint="Danach richtet sich zum Beispiel, wen eine Mitteilung „an die Betreuung“ erreicht."
        error={fieldError("base_role")}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {BASE_ROLES.map((baseRole) => {
            const id = `${idPrefix}-base-role-${baseRole}`;
            return (
              <ChoiceTile
                key={baseRole}
                htmlFor={id}
                selected={draft.baseRole === baseRole}
                disabled={disabled}
                className="items-start p-3"
              >
                <Radio
                  id={id}
                  name={`${idPrefix}-base-role`}
                  value={baseRole}
                  checked={draft.baseRole === baseRole}
                  disabled={disabled}
                  onChange={() => set({ baseRole })}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">
                    {schoolRoleBaseLabel(baseRole)}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-gray-600">
                    {BASE_ROLE_MEANING[baseRole]}
                    {creating ? ` ${BASE_ROLE_START[baseRole]}` : ""}
                  </span>
                </span>
              </ChoiceTile>
            );
          })}
        </div>
      </FormFieldset>
    </div>
  );
}
