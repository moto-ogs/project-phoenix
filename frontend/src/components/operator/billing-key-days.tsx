"use client";

import { useMemo, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataField } from "~/components/ui/data-field";
import { EmptyState } from "~/components/ui/empty-state";
import { FieldLabel } from "~/components/ui/field-label";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { ConfirmationModal } from "~/components/ui/modal";
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
import { calendarConcept } from "~/lib/concepts/calendar";
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

const logger = createLogger({ component: "BillingKeyDays" });

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

/** The dialog: the standard, a new own day, or one listed own day. */
type Editing =
  | { readonly mode: "standard" }
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly override: BillingKeyDayOverride };

/** Whose day the dialog sets: every school without one, or an own day. */
type Reach = "standard" | BillingKeyDayScope;

function overrideKey(override: BillingKeyDayOverride): string {
  return `${override.scope}-${override.id}`;
}

/** What an own day replaces, in the words of the list. */
function overrideMeta(override: BillingKeyDayOverride): string {
  return override.scope === "school"
    ? `Schule von ${override.organizationName}`
    : "Träger, für seine Schulen ohne eigenen Stichtag";
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

/** One row of the card: icon, name and what it covers, day, menu. */
function KeyDayRow({
  icon,
  name,
  meta,
  keyDay,
  nextKeyDate,
  menu,
}: Readonly<{
  icon: React.ReactNode;
  name: string;
  meta: string;
  keyDay: number;
  nextKeyDate: string;
  menu: React.ReactNode;
}>) {
  return (
    <ResponsiveActionRow>
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="text-sm font-semibold break-words text-gray-900">
            {name}
          </p>
          <p className="text-sm break-words text-gray-500">{meta}</p>
        </div>
      </div>
      <ResponsiveRowActions leading={36} menu={menu}>
        <p className="text-sm whitespace-nowrap text-gray-900 tabular-nums sm:text-right">
          <span className="font-semibold">Jeden Monat am {keyDay}.</span>
          <span className="block text-gray-500">
            nächster am {formatDate(nextKeyDate)}
          </span>
        </p>
      </ResponsiveRowActions>
    </ResponsiveActionRow>
  );
}

/**
 * The key days of the operator billing report (#2791, #7301): the standard
 * of every school first, then the own days of Träger and schools whose
 * contract names another day. A school's day wins over its Träger's, a
 * Träger's over the standard. Only the moto team sets them.
 */
export function BillingKeyDays({
  keyDay,
  loading,
  capturedThisMonth,
  onChanged,
}: Readonly<{
  /** The key day with its overrides; undefined while it loads or failed. */
  keyDay: BillingKeyDay | undefined;
  loading: boolean;
  /** Schools with figures for the running month; undefined until loaded. */
  capturedThisMonth: ReadonlySet<string> | undefined;
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
        object: `der Stichtag von ${override.name}`,
        retry: () => void reset(override),
      });
    } finally {
      setResetting(false);
      setRemoving(null);
    }
  };

  return (
    <SectionCard
      title="Stichtage"
      description="Der Standard gilt für jede Schule ohne eigenen Stichtag. Nennt ein Vertrag einen anderen Tag, bekommt der Träger oder die Schule ihn hier. Der Tag einer Schule geht dem ihres Trägers vor."
      action={
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => setEditing({ mode: "create" })}
          disabled={!keyDay}
          disabledReason="Geht erst, wenn die Stichtage geladen sind."
        >
          Eigenen Stichtag festlegen
        </Button>
      }
    >
      {loading ? (
        <SkeletonRows rows={2} />
      ) : !keyDay ? (
        <EmptyState
          variant="compact"
          title="Stichtage konnten nicht geladen werden"
          description="Lade sie oben mit „Wiederholen“ neu."
        />
      ) : (
        <ResponsiveActionList>
          <KeyDayRow
            icon={<ConceptIconTile concept={calendarConcept} size="sm" />}
            name="Standard"
            meta={
              keyDay.overrides.length === 0
                ? "Für alle Schulen"
                : "Für alle Schulen ohne eigenen Stichtag"
            }
            keyDay={keyDay.keyDay}
            nextKeyDate={keyDay.nextKeyDate}
            menu={
              <OverflowMenu
                ariaLabel="Aktionen für den Standard"
                items={[
                  {
                    label: "Tag ändern",
                    description:
                      "Legt den Tag für alle Schulen ohne eigenen Stichtag fest.",
                    onClick: () => setEditing({ mode: "standard" }),
                  },
                ]}
              />
            }
          />
          {keyDay.overrides.map((override) => (
            <KeyDayRow
              key={overrideKey(override)}
              icon={
                <ConceptIconTile
                  concept={
                    override.scope === "school"
                      ? schoolsConcept
                      : organizationsConcept
                  }
                  size="sm"
                />
              }
              name={override.name}
              meta={overrideMeta(override)}
              keyDay={override.keyDay}
              nextKeyDate={override.nextKeyDate}
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
            />
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

      {editing && keyDay ? (
        <KeyDayModal
          editing={editing}
          keyDay={keyDay}
          capturedThisMonth={capturedThisMonth}
          onClose={() => setEditing(null)}
          onSaved={(updated, message) => {
            onChanged(updated);
            toastSuccess(message);
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

interface LiveSchool {
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
}

/**
 * The live Träger and schools: the choices of a new own day (those without
 * one yet) and the schools a changed day reaches.
 */
function useTargets(
  scope: BillingKeyDayScope,
  overrides: readonly BillingKeyDayOverride[],
) {
  const organizations = useSWRAuth(
    operatorProvisioningKeys.organizations(),
    () => operatorProvisioningService.listOrganizations(),
    { revalidateOnFocus: false },
  );
  const schools = useSWRAuth(
    operatorProvisioningKeys.schools(),
    () => operatorProvisioningService.listSchools(),
    { revalidateOnFocus: false },
  );
  const loadError = useSwrLoadError(
    organizations.error ?? schools.error,
    "die Liste der Träger und Schulen",
    () => {
      void organizations.mutate();
      void schools.mutate();
    },
  );

  const liveSchools = useMemo<LiveSchool[]>(
    () => (schools.data ?? []).filter((school) => school.deletedAt == null),
    [schools.data],
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
    return liveSchools
      .filter((school) => !taken.has(school.id))
      .map((school) => {
        const traeger = names.get(school.organizationId);
        return {
          value: school.id,
          label: traeger ? `${school.name} (${traeger})` : school.name,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "de"));
  }, [organizations.data, liveSchools, overrides, scope]);

  const loading = organizations.isLoading || schools.isLoading;
  return { options, loading, loadError, schools: liveSchools };
}

/**
 * The schools a new day that is already reached this month leaves without
 * figures for it: those the day reaches that have none yet. The standard
 * reaches every school whose Träger and itself have no own day; a Träger's
 * day its schools without an own day; a school's day the school.
 */
function schoolsMissingTheMonth(
  reach: Reach,
  targetId: string,
  schools: readonly LiveSchool[],
  overrides: readonly BillingKeyDayOverride[],
  captured: ReadonlySet<string>,
): string[] {
  const ownDay = (scope: BillingKeyDayScope) =>
    new Set(
      overrides
        .filter((override) => override.scope === scope)
        .map((override) => override.id),
    );
  const schoolDays = ownDay("school");
  const traegerDays = ownDay("organization");
  return schools
    .filter((school) => {
      switch (reach) {
        case "school":
          return school.id === targetId;
        case "organization":
          return (
            school.organizationId === targetId && !schoolDays.has(school.id)
          );
        default:
          return (
            !schoolDays.has(school.id) &&
            !traegerDays.has(school.organizationId)
          );
      }
    })
    .filter((school) => !captured.has(school.id))
    .map((school) => school.name)
    .sort((a, b) => a.localeCompare(b, "de"));
}

function KeyDayModal({
  editing,
  keyDay: current,
  capturedThisMonth,
  onClose,
  onSaved,
}: Readonly<{
  editing: Editing;
  keyDay: BillingKeyDay;
  capturedThisMonth: ReadonlySet<string> | undefined;
  onClose: () => void;
  onSaved: (keyDay: BillingKeyDay, message: string) => void;
}>) {
  const existing = editing.mode === "edit" ? editing.override : null;
  const standard = editing.mode === "standard";
  const [scope, setScope] = useState<BillingKeyDayScope>(
    existing?.scope ?? "organization",
  );
  const [targetId, setTargetId] = useState(existing?.id ?? "");
  const initialDay = standard ? current.keyDay : existing?.keyDay;
  const [day, setDay] = useState(initialDay ? String(initialDay) : "");
  const save = useFormModalPending();
  const errors = useApiFormError();
  const targets = useTargets(scope, current.overrides);
  const reach: Reach = standard ? "standard" : scope;

  const today = berlinTodayISO();
  const newDay = day === "" ? null : Number(day);
  const unchanged = initialDay !== undefined && newDay === initialDay;
  const chosen = standard || targetId !== "";
  const ready = chosen && newDay !== null && !unchanged;
  const targetName = standard
    ? ""
    : (existing?.name ??
      (scope === "school"
        ? targets.schools.find((school) => school.id === targetId)?.name
        : targets.options.find((option) => option.value === targetId)?.label) ??
      "");

  const passed = newDay !== null && keyDayPassedThisMonth(newDay, today);
  // Unknown until the figures and the school list are loaded; then the
  // dialog names who misses the month instead of guessing.
  const missing =
    passed && capturedThisMonth && !targets.loading && chosen
      ? schoolsMissingTheMonth(
          reach,
          targetId,
          targets.schools,
          current.overrides,
          capturedThisMonth,
        )
      : null;
  const skipsMonth = passed && (missing === null || missing.length > 0);

  const submit = async () => {
    if (!ready || newDay === null) return;
    await save.run(async (op) => {
      errors.clear();
      let updated: BillingKeyDay;
      try {
        updated = standard
          ? await operatorBillingService.updateKeyDay(newDay)
          : await operatorBillingService.setKeyDayOverride(
              scope,
              targetId,
              newDay,
            );
      } catch (saveError) {
        logger.warn("billing_key_day_save_failed", {
          error: saveError instanceof Error ? saveError.message : "unknown",
        });
        if (op.isCurrent()) {
          void errors.show(saveError, { object: "der Stichtag" });
        }
        return;
      }
      if (standard) {
        onSaved(
          updated,
          `Der Standard ist jetzt der ${updated.keyDay}. Nächster Stichtag: ${formatDate(updated.nextKeyDate)}.`,
        );
      } else {
        const saved = updated.overrides.find(
          (override) => override.scope === scope && override.id === targetId,
        );
        if (saved) {
          onSaved(
            updated,
            `${sentence(`${saved.name} zählt ab jetzt am ${saved.keyDay}`)} Nächster Stichtag: ${formatDate(saved.nextKeyDate)}.`,
          );
        }
      }
      if (op.isCurrent()) onClose();
    });
  };

  const title = standard
    ? "Standard-Stichtag"
    : existing
      ? `Stichtag von ${existing.name}`
      : "Eigener Stichtag";

  return (
    <FormModal
      isOpen
      onClose={onClose}
      pending={save}
      size="md"
      title={title}
      error={errors.error}
      footer={
        <>
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="button"
            size="md"
            variant={skipsMonth && ready ? "warning" : "primary"}
            onClick={() => void submit()}
            isLoading={save.pending}
            loadingText="Wird gespeichert…"
            disabled={!ready || save.pending}
            disabledReason={
              unchanged
                ? "Wähle einen anderen Tag als den bisherigen."
                : standard || existing
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
        {standard ? (
          <DataField label="Gilt für">
            Alle Schulen ohne eigenen Stichtag
          </DataField>
        ) : existing ? (
          <DataField label="Gilt für">
            {existing.scope === "school"
              ? `${existing.name}, Schule von ${existing.organizationName}`
              : `${existing.name} und seine Schulen ohne eigenen Stichtag`}
          </DataField>
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
              <p className="text-sm text-gray-500">
                {scope === "school"
                  ? "Gilt nur für diese Schule, auch wenn ihr Träger einen eigenen Tag hat."
                  : "Gilt für alle Schulen des Trägers, die keinen eigenen Tag haben."}
              </p>
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
            />
          </>
        )}
        <div className="max-w-xs">
          <CustomSelect
            id="key-day-day"
            label="Tag im Monat"
            required
            hint={
              standard
                ? "Höchstens der 28., damit jeder Monat den Tag hat."
                : `Standard ist der ${current.keyDay}. Höchstens der 28., damit jeder Monat den Tag hat.`
            }
            value={day}
            options={KEY_DAY_OPTIONS}
            onChange={setDay}
            error={errors.fieldError("key_day")}
          />
        </div>
        {newDay !== null && chosen && !unchanged ? (
          <KeyDayPreview
            name={targetName}
            keyDay={newDay}
            today={today}
            passed={passed}
            missing={missing}
          />
        ) : null}
      </div>
    </FormModal>
  );
}

/** "A", "A und B", "A, B und C", or "4 Schulen" for more. */
function schoolList(names: readonly string[]): string {
  if (names.length > 3) return `${names.length} Schulen`;
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;
}

/** What the save will do, before it is done. */
function KeyDayPreview({
  name,
  keyDay,
  today,
  passed,
  missing,
}: Readonly<{
  /** The Träger or school; empty for the standard. */
  name: string;
  keyDay: number;
  today: string;
  passed: boolean;
  /** Schools that would get no figures this month; null while unknown. */
  missing: readonly string[] | null;
}>) {
  const next = formatDate(nextBillingKeyDate(keyDay, today));
  const month = billingMonthName(today);
  const nextLine = name
    ? `Nächster Stichtag von ${name}: ${next}.`
    : `Nächster Stichtag: ${next}.`;
  if (!passed) {
    return (
      <Alert
        type="info"
        message={`${nextLine} Schon erfasste Monate bleiben, wie sie sind.`}
      />
    );
  }
  if (missing !== null && missing.length === 0) {
    return (
      <Alert
        type="info"
        message={`Der ${keyDay}. ist im ${month} schon vorbei. Die Zahlen für ${month} stehen schon und bleiben, wie sie sind. Nächster Stichtag: ${next}.`}
      />
    );
  }
  const who =
    missing === null
      ? "Schulen ohne Zahlen für diesen Monat bekommen"
      : missing.length === 1
        ? `${schoolList(missing)} hat noch keine Zahlen für ${month} und bekommt`
        : `${schoolList(missing)} haben noch keine Zahlen für ${month} und bekommen`;
  return (
    <Alert
      type="warning"
      message={`Der ${keyDay}. ist im ${month} schon vorbei. ${who} für diesen Monat keine mehr. Nächster Stichtag: ${next}.`}
    />
  );
}
