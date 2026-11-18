"use client";

import { useMemo, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { CustomSelect } from "~/components/ui/custom-select";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ConfirmationModal } from "~/components/ui/modal";
import { FieldLabel } from "~/components/ui/field-label";
import { FormModal } from "~/components/ui/form-modal";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { organizationsConcept } from "~/lib/concepts/organizations";
import { schoolsConcept } from "~/lib/concepts/schools";
import { berlinTodayISO, formatDate } from "~/lib/date-helpers";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import {
  BILLING_KEY_DAY_MAX,
  BILLING_KEY_DAY_MIN,
  operatorBillingService,
  type BillingKeyDay,
  type BillingKeyDayOverride,
  type BillingKeyDayScope,
} from "~/lib/operator/billing-api";
import {
  billingMonthName,
  keyDayPassedThisMonth,
  nextBillingKeyDate,
} from "~/lib/operator/billing-key-day";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
// eslint-disable-next-line no-restricted-imports -- operator pages are not tenant-scoped
import { useSWRAuth } from "~/lib/swr";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";

const logger = createLogger({ component: "BillingKeyDayOverrides" });

const KEY_DAY_OPTIONS = Array.from(
  { length: BILLING_KEY_DAY_MAX - BILLING_KEY_DAY_MIN + 1 },
  (_, index) => {
    const day = String(BILLING_KEY_DAY_MIN + index);
    return { value: day, label: `${day}.` };
  },
);

const SCOPE_ITEMS = [
  { value: "organization", label: "Träger" },
  { value: "school", label: "Schule" },
] as const;

/** The dialog: a new own day, or the day of one listed override. */
type Editing =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly override: BillingKeyDayOverride };

function overrideKey(override: BillingKeyDayOverride): string {
  return `${override.scope}-${override.id}`;
}

/** What the override replaces, in the words of the list. */
function overrideMeta(override: BillingKeyDayOverride): string {
  return override.scope === "school"
    ? `Schule von ${override.organizationName}`
    : "Träger, gilt für alle Schulen ohne eigenen Stichtag";
}

/** Ends a sentence once, also after a name like „Ganztag Nord e. V.“. */
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/**
 * What applies after the own day is gone: a school falls back to its
 * Träger's own day or the standard, a Träger to the standard.
 */
function fallbackSentence(
  override: BillingKeyDayOverride,
  overrides: readonly BillingKeyDayOverride[],
  standardDay: number | undefined,
): string {
  if (override.scope === "organization") {
    return standardDay
      ? `${override.name} und seine Schulen ohne eigenen Stichtag zählen dann wieder am ${standardDay}., dem Standard.`
      : `${override.name} und seine Schulen ohne eigenen Stichtag zählen dann wieder am Standard.`;
  }
  // The list names a school's Träger by name only; Träger names are unique
  // enough to point at the right row here.
  const traeger = overrides.find(
    (other) =>
      other.scope === "organization" &&
      other.name === override.organizationName,
  );
  const day = traeger?.keyDay ?? standardDay;
  const whose = traeger
    ? `dem Tag von ${override.organizationName}`
    : "dem Standard";
  return day
    ? sentence(`${override.name} zählt dann wieder am ${day}., ${whose}`)
    : sentence(
        `${override.name} zählt dann wieder am Tag von ${override.organizationName}`,
      );
}

/**
 * Own key days of Träger and schools (#7301): a contract that names another
 * day than the standard gets it here. A school's day wins over its
 * Träger's, a Träger's over the standard. Only the moto team sets them.
 */
export function BillingKeyDayOverrides({
  keyDay,
  loading,
  onChanged,
}: Readonly<{
  /** The key day with its overrides; undefined while it loads or failed. */
  keyDay: BillingKeyDay | undefined;
  loading: boolean;
  /** Takes the key day the write answered, overrides included. */
  onChanged: (keyDay: BillingKeyDay) => void;
}>) {
  const standardDay = keyDay?.keyDay;
  const overrides = keyDay?.overrides;
  const { success: toastSuccess } = useToast();
  const { show: showResetError } = useApiErrorDisplay();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<BillingKeyDayOverride | null>(null);
  const [resetting, setResetting] = useState(false);

  const reset = async (override: BillingKeyDayOverride) => {
    setResetting(true);
    try {
      const updated = await operatorBillingService.resetKeyDayOverride(
        override.scope,
        override.id,
      );
      onChanged(updated);
      toastSuccess(
        override.scope === "school"
          ? sentence(
              `${override.name} zählt wieder am Stichtag von ${override.organizationName}`,
            )
          : sentence(`${override.name} zählt wieder am Standard-Stichtag`),
      );
    } catch (resetError) {
      logger.warn("billing_key_day_override_reset_failed", {
        error: resetError instanceof Error ? resetError.message : "unknown",
      });
      void showResetError(resetError, {
        object: `den Stichtag von ${override.name}`,
        retry: () => void reset(override),
      });
    } finally {
      setResetting(false);
      setRemoving(null);
    }
  };

  const count = overrides?.length ?? 0;

  return (
    <SectionCard
      title="Eigene Stichtage"
      description={
        standardDay
          ? `Für Verträge mit einem anderen Tag als dem ${standardDay}. Der Tag einer Schule geht dem ihres Trägers vor.`
          : "Für Verträge mit einem anderen Tag als dem Standard. Der Tag einer Schule geht dem ihres Trägers vor."
      }
      action={
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => setEditing({ mode: "create" })}
          disabled={!overrides}
        >
          Stichtag festlegen
        </Button>
      }
    >
      {loading ? (
        <SkeletonRows rows={2} />
      ) : !overrides ? (
        <EmptyState
          variant="compact"
          title="Eigene Stichtage nicht geladen"
          description="Sie stehen mit dem Standard oben. Lädt er wieder, erscheinen sie hier."
        />
      ) : count === 0 ? (
        <EmptyState
          variant="compact"
          title="Alle Schulen zählen am Standard-Stichtag"
          description="Braucht ein Vertrag einen anderen Tag, lege ihn oben mit „Stichtag festlegen“ fest."
        />
      ) : (
        <ResponsiveActionList>
          {overrides.map((override) => (
            <ResponsiveActionRow key={overrideKey(override)}>
              <div className="flex min-w-0 items-center gap-3">
                <ConceptIconTile
                  concept={
                    override.scope === "school"
                      ? schoolsConcept
                      : organizationsConcept
                  }
                  size="sm"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {override.name}
                  </p>
                  <p className="truncate text-sm text-gray-500">
                    {overrideMeta(override)}
                  </p>
                </div>
              </div>
              <ResponsiveRowActions
                leading={36}
                menu={
                  <OverflowMenu
                    ariaLabel={`Aktionen für ${override.name}`}
                    items={[
                      {
                        label: "Tag ändern",
                        description: "Legt einen anderen Tag im Monat fest.",
                        onClick: () => setEditing({ mode: "edit", override }),
                      },
                      {
                        label: "Eigenen Stichtag aufheben",
                        description: "moto fragt vorher nach.",
                        onClick: () => setRemoving(override),
                      },
                    ]}
                  />
                }
              >
                <p className="text-sm whitespace-nowrap text-gray-900 tabular-nums sm:text-right">
                  <span className="font-semibold">
                    Jeden Monat am {override.keyDay}.
                  </span>
                  <span className="block text-gray-500">
                    nächster am {formatDate(override.nextKeyDate)}
                  </span>
                </p>
              </ResponsiveRowActions>
            </ResponsiveActionRow>
          ))}
        </ResponsiveActionList>
      )}

      <ConfirmationModal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void reset(removing)}
        title="Eigenen Stichtag aufheben"
        confirmText="Aufheben"
        confirmVariant="warning"
        confirmTooltip="Hebt den eigenen Stichtag sofort auf."
        isConfirmLoading={resetting}
        loadingText="Wird aufgehoben …"
        isConfirmDisabled={resetting}
      >
        <p>
          {removing
            ? fallbackSentence(removing, overrides ?? [], standardDay)
            : ""}{" "}
          Schon erfasste Monate bleiben, wie sie sind.
        </p>
      </ConfirmationModal>

      {editing ? (
        <KeyDayOverrideModal
          editing={editing}
          overrides={overrides ?? []}
          standardDay={standardDay}
          onClose={() => setEditing(null)}
          onSaved={(updated, saved) => {
            onChanged(updated);
            toastSuccess(
              `${sentence(`${saved.name} zählt ab jetzt am ${saved.keyDay}`)} Nächster Stichtag: ${formatDate(saved.nextKeyDate)}.`,
            );
          }}
        />
      ) : null}
    </SectionCard>
  );
}

interface TargetOption {
  readonly value: string;
  readonly label: string;
}

/** The live Träger and schools that have no own day yet, by name. */
function useTargetOptions(
  scope: BillingKeyDayScope,
  overrides: readonly BillingKeyDayOverride[],
  enabled: boolean,
) {
  const organizations = useSWRAuth(
    enabled ? operatorProvisioningKeys.organizations() : null,
    () => operatorProvisioningService.listOrganizations(),
    { revalidateOnFocus: false },
  );
  const schools = useSWRAuth(
    enabled && scope === "school" ? operatorProvisioningKeys.schools() : null,
    () => operatorProvisioningService.listSchools(),
    { revalidateOnFocus: false },
  );
  const failed = scope === "school" ? schools.error : organizations.error;
  const loadError = useSwrLoadError(
    failed,
    scope === "school" ? "die Liste der Schulen" : "die Liste der Träger",
    () => void (scope === "school" ? schools.mutate() : organizations.mutate()),
  );

  const options = useMemo<TargetOption[]>(() => {
    const taken = new Set(
      overrides
        .filter((override) => override.scope === scope)
        .map((override) => override.id),
    );
    const live = (organizations.data ?? []).filter(
      (organization) => organization.deletedAt == null,
    );
    if (scope === "organization") {
      return live
        .filter((organization) => !taken.has(organization.id))
        .map((organization) => ({
          value: organization.id,
          label: organization.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "de"));
    }
    const names = new Map(live.map((org) => [org.id, org.name]));
    return (schools.data ?? [])
      .filter((school) => school.deletedAt == null && !taken.has(school.id))
      .map((school) => {
        const traeger = names.get(school.organizationId);
        return {
          value: school.id,
          label: traeger ? `${school.name} (${traeger})` : school.name,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "de"));
  }, [organizations.data, schools.data, overrides, scope]);

  const loading =
    organizations.isLoading || (scope === "school" && schools.isLoading);
  return { options, loading, loadError };
}

function KeyDayOverrideModal({
  editing,
  overrides,
  standardDay,
  onClose,
  onSaved,
}: Readonly<{
  editing: Editing;
  overrides: readonly BillingKeyDayOverride[];
  standardDay: number | undefined;
  onClose: () => void;
  onSaved: (keyDay: BillingKeyDay, saved: BillingKeyDayOverride) => void;
}>) {
  const existing = editing.mode === "edit" ? editing.override : null;
  const [scope, setScope] = useState<BillingKeyDayScope>(
    existing?.scope ?? "organization",
  );
  const [targetId, setTargetId] = useState(existing?.id ?? "");
  const [day, setDay] = useState(existing ? String(existing.keyDay) : "");
  const save = useFormModalPending();
  const errors = useApiFormError();
  const targets = useTargetOptions(scope, overrides, existing === null);

  const today = berlinTodayISO();
  const keyDay = day === "" ? null : Number(day);
  const unchanged = existing !== null && keyDay === existing.keyDay;
  const ready = targetId !== "" && keyDay !== null && !unchanged;
  const targetName =
    existing?.name ??
    targets.options.find((option) => option.value === targetId)?.label ??
    "";

  const submit = async () => {
    if (!ready || keyDay === null) return;
    await save.run(async (op) => {
      errors.clear();
      let updated: BillingKeyDay;
      try {
        updated = await operatorBillingService.setKeyDayOverride(
          scope,
          targetId,
          keyDay,
        );
      } catch (saveError) {
        logger.warn("billing_key_day_override_save_failed", {
          error: saveError instanceof Error ? saveError.message : "unknown",
        });
        if (op.isCurrent()) {
          void errors.show(saveError, { object: "den eigenen Stichtag" });
        }
        return;
      }
      const saved = updated.overrides.find(
        (override) => override.scope === scope && override.id === targetId,
      );
      if (saved) onSaved(updated, saved);
      if (op.isCurrent()) onClose();
    });
  };

  const passed = keyDay !== null && keyDayPassedThisMonth(keyDay, today);
  const scopeHint =
    scope === "school"
      ? "Gilt nur für diese Schule, auch wenn ihr Träger einen eigenen Tag hat."
      : "Gilt für alle Schulen des Trägers, die keinen eigenen Tag haben.";

  return (
    <FormModal
      isOpen
      onClose={onClose}
      pending={save}
      size="md"
      title={existing ? `Stichtag von ${existing.name}` : "Eigener Stichtag"}
      error={errors.error}
      footer={
        <>
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="button"
            size="md"
            onClick={() => void submit()}
            isLoading={save.pending}
            loadingText="Wird gespeichert…"
            disabled={!ready || save.pending}
            disabledReason={
              unchanged
                ? "Wähle einen anderen Tag als den bisherigen."
                : existing
                  ? "Wähle zuerst den Tag im Monat."
                  : "Wähle zuerst, für wen der Tag gilt, und den Tag im Monat."
            }
          >
            Stichtag festlegen
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {existing ? (
          <p className="text-sm text-gray-600">{overrideMeta(existing)}</p>
        ) : (
          <>
            <div className="space-y-2">
              <FieldLabel id="key-day-scope-label">Gilt für</FieldLabel>
              <SegmentedControl
                ariaLabel="Gilt für"
                items={SCOPE_ITEMS}
                value={scope}
                onChange={(next) => {
                  setScope(next);
                  setTargetId("");
                }}
              />
              <p className="text-sm text-gray-500">{scopeHint}</p>
            </div>
            <LoadErrorAlert error={targets.loadError} />
            <CustomSelect
              id="key-day-target"
              label={scope === "school" ? "Schule" : "Träger"}
              required
              searchable
              searchPlaceholder={
                scope === "school" ? "Schule suchen" : "Träger suchen"
              }
              placeholder={
                targets.loading
                  ? "Wird geladen…"
                  : scope === "school"
                    ? "Schule wählen"
                    : "Träger wählen"
              }
              disabled={targets.loading}
              value={targetId}
              options={targets.options}
              onChange={setTargetId}
              error={errors.fieldError("school_id")}
            />
          </>
        )}
        <div className="max-w-xs">
          <CustomSelect
            id="key-day-day"
            label="Tag im Monat"
            required
            hint={
              standardDay
                ? `Standard ist der ${standardDay}. Höchstens der 28., damit jeder Monat den Tag hat.`
                : "Höchstens der 28., damit jeder Monat den Tag hat."
            }
            value={day}
            options={KEY_DAY_OPTIONS}
            onChange={setDay}
            error={errors.fieldError("key_day")}
          />
        </div>
        {keyDay !== null && targetId !== "" && !unchanged ? (
          <KeyDayPreview
            name={targetName}
            keyDay={keyDay}
            today={today}
            passed={passed}
          />
        ) : null}
      </div>
    </FormModal>
  );
}

/** What the save will do, in one line, before it is done. */
function KeyDayPreview({
  name,
  keyDay,
  today,
  passed,
}: Readonly<{ name: string; keyDay: number; today: string; passed: boolean }>) {
  const next = nextBillingKeyDate(keyDay, today);
  if (passed) {
    return (
      <Alert
        type="warning"
        message={`Der ${keyDay}. ist im ${billingMonthName(today)} schon vorbei. Schulen ohne Zahlen für ${billingMonthName(today)} bekommen für diesen Monat keine mehr. Nächster Stichtag von ${name}: ${formatDate(next)}.`}
      />
    );
  }
  return (
    <Alert
      type="info"
      message={`Nächster Stichtag von ${name}: ${formatDate(next)}. Schon erfasste Monate bleiben, wie sie sind.`}
    />
  );
}
