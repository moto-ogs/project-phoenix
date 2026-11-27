"use client";

import { CustomSelect } from "~/components/ui/custom-select";
import { FieldLabel } from "~/components/ui/field-label";

interface DatabaseSelectProps {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
  }>;
  readonly placeholder: string;
  readonly disabled?: boolean;
}

export function DatabaseSelect({
  name,
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: DatabaseSelectProps) {
  return (
    <div className="w-full">
      <FieldLabel htmlFor={name} className="mb-1 text-xs md:text-sm">
        {label}
      </FieldLabel>
      <CustomSelect
        ariaLabel={label}
        id={name}
        name={name}
        value={value}
        options={[{ value: "", label: placeholder }, ...options]}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
      />
    </div>
  );
}
