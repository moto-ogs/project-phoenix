"use client";

/**
 * TraegerSchoolChoice picks the schools an opening change of the Träger
 * applies to (#8202): „Alle Schulen“ or single schools, as the closing day
 * dialog of the Träger shows them (#4702).
 */

import { Checkbox } from "~/components/ui/checkbox";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { FormFieldset } from "~/components/ui/form-fieldset";

export interface TraegerSchoolOption {
  readonly id: string;
  readonly name: string;
}

export function TraegerSchoolChoice({
  schools,
  selected,
  onChange,
  error,
}: Readonly<{
  schools: readonly TraegerSchoolOption[];
  selected: readonly string[];
  onChange: (schoolIds: string[]) => void;
  error?: string;
}>) {
  const allSelected =
    schools.length > 0 && schools.every((s) => selected.includes(s.id));
  const toggle = (id: string, checked: boolean) =>
    onChange(
      checked
        ? [...selected.filter((value) => value !== id), id]
        : selected.filter((value) => value !== id),
    );
  return (
    <FormFieldset legend="Gilt für" required error={error}>
      <div className="space-y-2">
        <ChoiceTile selected={allSelected} className="px-3 py-2.5">
          <Checkbox
            checked={allSelected}
            onChange={(event) =>
              onChange(event.target.checked ? schools.map((s) => s.id) : [])
            }
          />
          <span className="text-sm font-semibold text-gray-900">
            Alle Schulen
          </span>
        </ChoiceTile>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {schools.map((school) => (
            <ChoiceTile
              key={school.id}
              selected={selected.includes(school.id)}
              className="px-3 py-2.5"
            >
              <Checkbox
                checked={selected.includes(school.id)}
                onChange={(event) => toggle(school.id, event.target.checked)}
              />
              <span className="min-w-0 text-sm wrap-anywhere text-gray-900">
                {school.name}
              </span>
            </ChoiceTile>
          ))}
        </div>
      </div>
    </FormFieldset>
  );
}
