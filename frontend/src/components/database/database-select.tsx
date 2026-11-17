"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { CustomSelect } from "~/components/ui/custom-select";
import { FieldLabel } from "~/components/ui/field-label";
import type { FormErrorInput } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { apiErrorFromResponse, unavailableApiError } from "~/lib/api-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { databaseKeys } from "~/lib/swr/portal-keys";

const logger = createLogger({ component: "DatabaseSelect" });

const NO_OPTIONS: ReadonlyArray<SelectOption> = [];

interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * The options to choose from. A failed load of them goes to the owner's
 * shared load path (`useApiLoadError`, #2517) and comes back as `loadError`:
 * while it is set the select gives way to that text, never to an empty list.
 */
type DatabaseSelectOptionsSource = {
  readonly options?: ReadonlyArray<SelectOption>;
  readonly loadError?: FormErrorInput;
};

type DatabaseSelectProps = DatabaseSelectOptionsSource & {
  // Core props
  readonly id?: string;
  readonly name: string;
  readonly label?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;

  // UI props
  readonly placeholder?: string;
  readonly emptyOptionLabel?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly error?: string;
  readonly helperText?: string;
  readonly className?: string;
  readonly includeEmpty?: boolean;
};

export function DatabaseSelect({
  id,
  name,
  label,
  value,
  onChange,
  options = NO_OPTIONS,
  loadError = null,
  placeholder = "Bitte wählen",
  emptyOptionLabel,
  required = false,
  disabled = false,
  loading = false,
  error: externalError,
  helperText,
  className = "",
  includeEmpty = true,
}: DatabaseSelectProps) {
  const isLoading = loading;
  const displayError = externalError;

  const selectOptions = [
    ...(includeEmpty
      ? [
          {
            value: "",
            label: isLoading ? "Lädt..." : (emptyOptionLabel ?? placeholder),
          },
        ]
      : []),
    ...options.map((option) => ({
      value: option.value,
      label: option.label,
      disabled: option.disabled,
    })),
    ...(!isLoading && options.length === 0 && !includeEmpty
      ? [{ value: "", label: "Keine Optionen verfügbar", disabled: true }]
      : []),
  ];

  return (
    <div className="w-full">
      {label && (
        <FieldLabel
          htmlFor={id ?? name}
          required={required}
          className="mb-1 text-xs md:text-sm"
        >
          {label}
        </FieldLabel>
      )}

      {loadError ? (
        <LoadErrorAlert error={loadError} />
      ) : (
        <CustomSelect
          ariaLabel={label ?? name}
          id={id ?? name}
          name={name}
          value={value}
          options={selectOptions}
          onChange={onChange}
          disabled={disabled || isLoading}
          required={required}
          invalid={Boolean(displayError)}
          placeholder={
            isLoading ? "Lädt..." : (emptyOptionLabel ?? placeholder)
          }
          className={`${isLoading ? "cursor-wait opacity-50" : ""} ${className}`}
        />
      )}

      {/* Helper text or error message */}
      {displayError && (
        <p className="text-moto-red mt-1 text-xs md:text-sm">{displayError}</p>
      )}
      {!displayError && helperText && (
        <p className="mt-1 text-xs text-gray-500 md:text-sm">{helperText}</p>
      )}
    </div>
  );
}

/**
 * Specialized select components using DatabaseSelect as base
 */

// EntitySelect: the options of one API list, read through the shared cache.
type EntitySelectProps = Omit<DatabaseSelectProps, "options" | "loadError"> & {
  readonly entityType: "groups" | "rooms" | "teachers" | "activities";
  readonly filters?: Record<string, unknown>;
  /**
   * The owner's load path (`useApiLoadError`, #2517): a failed load goes to
   * `onLoadError` with a retry, its catalog text comes back as `loadError`.
   * The owner's retry clears `loadError` and then calls the handed-in retry.
   */
  readonly loadError: FormErrorInput;
  readonly onLoadError: (error: unknown, retry: () => void) => void;
};

function entityQuery(filters: Record<string, unknown> | undefined): string {
  const params = new URLSearchParams();
  Object.entries(filters ?? {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    // Convert value to string safely
    let stringValue: string;
    if (typeof value === "string") {
      stringValue = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      stringValue = String(value);
    } else {
      // For objects and other types, use JSON.stringify
      stringValue = JSON.stringify(value);
    }
    params.append(key, stringValue);
  });
  return params.toString();
}

async function fetchEntityOptions(
  entityType: EntitySelectProps["entityType"],
  queryString: string,
): Promise<ReadonlyArray<SelectOption>> {
  const url = queryString
    ? `/api/${entityType}?${queryString}`
    : `/api/${entityType}`;
  // A request that never reached the API becomes general.unavailable.
  const response = await fetch(url).catch((error: unknown) => {
    throw unavailableApiError(error);
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response, `Failed to load ${entityType}`);
  }

  const data = (await response.json()) as
    | Array<{ id: string | number; name: string }>
    | { data: Array<{ id: string | number; name: string }> };

  // Handle different response formats
  const items = Array.isArray(data) ? data : data.data;

  return items.map((item) => ({
    value: String(item.id),
    label: item.name,
  }));
}

function EntitySelect({
  entityType,
  filters,
  loadError,
  onLoadError,
  ...props
}: EntitySelectProps) {
  const queryString = entityQuery(filters);
  const read = useSWRAuth(
    databaseKeys.entityOptions(entityType, queryString),
    () => fetchEntityOptions(entityType, queryString),
    { keepPreviousData: false },
  );
  const failure = read.error;
  const retry = read.mutate;
  // The owner's handler of the current render reports the failure.
  const onLoadErrorRef = useRef(onLoadError);
  useLayoutEffect(() => {
    onLoadErrorRef.current = onLoadError;
  });
  useEffect(() => {
    if (failure === undefined) return;
    logger.warn("failed to load options", {
      error: failure instanceof Error ? failure.message : String(failure),
    });
    onLoadErrorRef.current(failure, () => void retry());
  }, [failure, retry]);

  return (
    <DatabaseSelect
      {...props}
      options={read.data}
      loading={props.loading === true || read.isLoading}
      loadError={loadError}
    />
  );
}

/**
 * Convenience components for specific entity types
 */

export function GroupSelect(
  props: Readonly<Omit<EntitySelectProps, "entityType">>,
) {
  return (
    <EntitySelect
      {...props}
      entityType="groups"
      label={props.label ?? "Gruppe"}
    />
  );
}
