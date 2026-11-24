"use client";

// Abwesenheitsarten des Trägers (#4710, ADR 0089 §10 mit Nachtrag, ADR 0236).
// Die Personalverwaltung legt Arten wie Regenerationstag an, mit Kontingent je
// Person und Jahr über alle Schulen. moto trägt jede Art in jede Schule; eine
// Schule darf nur für ihre Einsätze abweichen. Die Karte jeder Art zeigt
// deshalb, wie jede Schule sie führt.

import {
  PencilSimpleIcon,
  PlusIcon,
  ProhibitIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AbsenceTypeFields,
  EMPTY_ABSENCE_TYPE,
  absenceTypeDraftErrors,
  type AbsenceTypeDraft,
} from "~/components/traeger/staff/absence-type-fields";
import {
  absenceTypeSummary,
  schoolDeviationBadge,
} from "~/components/traeger/staff/absence-type-format";
import { StaffNotReleasedPage } from "~/components/traeger/staff/staff-not-released-page";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Button } from "~/components/ui/button";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { FramedList } from "~/components/ui/framed-list";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import {
  readStateWaitReason,
  useReadDraftForm,
  useReadDraftLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { useActionOn, useDraftOn } from "~/lib/swr/read-draft";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  createTraegerAbsenceType,
  fetchTraegerAbsenceTypes,
  updateTraegerAbsenceType,
  type TraegerAbsenceType,
} from "~/lib/traeger-absence-api";

const logger = createLogger({ component: "TraegerAbsenceTypesPage" });

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const INFO = (
  <div className="space-y-2">
    <p>
      Hier legst du eigene Arten an, etwa Regenerationstag oder Umwandlungstag.
      Urlaub, Krank, Fortbildung, Sonstige und Freizeitausgleich gibt es immer.
    </p>
    <p>
      moto trägt jede Art in jede deiner Schulen. Eine Schule darf abweichen,
      nur für ihre eigenen Einsätze: Sie bietet die Art nicht an, oder sie
      erlaubt weniger Tage. Mehr als das Kontingent erlaubt keine Schule.
    </p>
  </div>
);

function draftOf(type: TraegerAbsenceType): AbsenceTypeDraft {
  return {
    name: type.name,
    allowanceEnabled: type.allowanceEnabled,
    standardDays: type.standardDays,
    carryoverUntil: type.carryoverUntil,
    requestable: type.requestable,
    isActive: type.isActive,
  };
}

function CreateAbsenceTypeModal({
  isOpen,
  onClose,
  onCreated,
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  onCreated: (type: TraegerAbsenceType) => void;
}>) {
  const [draft, setDraft] = useState<AbsenceTypeDraft>(EMPTY_ABSENCE_TYPE);
  const save = useFormModalPending(isOpen);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const { clear: clearErrors } = errors;

  useEffect(() => {
    if (!isOpen) return;
    setDraft(EMPTY_ABSENCE_TYPE);
    clearErrors();
  }, [isOpen, clearErrors]);

  const submit = async () => {
    const invalid = absenceTypeDraftErrors(draft);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    await save.run(async (op) => {
      try {
        const created = await createTraegerAbsenceType(draft);
        if (op.isCurrent()) onCreated(created);
      } catch (err) {
        logger.error("traeger_absence_type_create_failed", {
          error: errorMessage(err),
        });
        if (op.isCurrent()) {
          void errors.show(err, { object: "die Abwesenheitsart" });
        }
      }
    });
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title="Abwesenheitsart anlegen"
      titleLevel={2}
      error={errors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={save.pending}
          saveLabel="Anlegen"
          saveTooltip="Legt die Art an und trägt sie sofort in alle deine Schulen."
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <AbsenceTypeFields
          idPrefix="traeger-absence-type-new"
          draft={draft}
          onChange={setDraft}
          fieldError={errors.fieldError}
        />
      </form>
    </FormModal>
  );
}

function AbsenceTypeCard({
  type,
  reload,
  onSaved,
}: Readonly<{
  type: TraegerAbsenceType;
  /** Reads the types again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<readonly TraegerAbsenceType[]>;
  onSaved: (type: TraegerAbsenceType, message: string) => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const display = useApiErrorDisplay();
  const storedType = async () => {
    const found = (await reload()).find((entry) => entry.id === type.id);
    if (!found) throw new Error("absence type is gone");
    return found;
  };
  // The form rests on the type as it was when editing began (ADR 0311): a
  // newer read refills it only while untouched, a refused save shows the
  // stored type with the message, and nothing goes out until it is read.
  const edit = useDraftOn<
    TraegerAbsenceType,
    AbsenceTypeDraft,
    string,
    TraegerAbsenceType
  >(
    {
      opening: editing ? `traeger-absence-type:${type.id}` : null,
      data: type,
      reload: storedType,
      write: async (stored) => onSaved(stored, ""),
    },
    {
      token: (read) => read.version,
      toDraft: draftOf,
      answer: (saved) => saved,
    },
  );
  const form = useReadDraftForm(
    editing ? edit : null,
    errors,
    "die Abwesenheitsart",
  );
  // Switching off and on sends the type as the card shows it: after a
  // refusal nothing goes out until the stored type is read.
  const toggle = useActionOn(
    { opening: `traeger-absence-type-switch:${type.id}`, data: type, reload },
    { token: (read) => read.version },
  );
  const toggleLoadError = useReadDraftLoadError(toggle, "die Abwesenheitsart");
  const toggleWait = readStateWaitReason(toggle.status);
  const draft = editing ? edit.draft : undefined;

  const switchActive = async (isActive: boolean, message: string) => {
    const result = await toggle.submit(() =>
      updateTraegerAbsenceType(
        type.id,
        { ...draftOf(type), isActive },
        type.version,
      ),
    );
    if (result.ok) {
      onSaved(result.saved, message);
      return;
    }
    if (result.skipped) return;
    logger.error("traeger_absence_type_update_failed", {
      error: errorMessage(result.error),
    });
    void display.show(result.error, {
      object: "die Abwesenheitsart",
      reload: result.reload,
    });
  };

  const save = async () => {
    if (!draft || !form.begin()) return;
    const invalid = absenceTypeDraftErrors(draft);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    setSaving(true);
    const result = await edit.submit((version, sent) =>
      updateTraegerAbsenceType(type.id, sent, version),
    );
    setSaving(false);
    if (result.ok) {
      setEditing(false);
      onSaved(
        result.saved,
        `Die Abwesenheitsart „${result.saved.name}“ ist gespeichert. Alle Schulen sehen sie.`,
      );
      return;
    }
    if (result.skipped) return;
    logger.error("traeger_absence_type_update_failed", {
      error: errorMessage(result.error),
    });
    // Changed since editing began: the form stays open on the stored type
    // and says so, without a retry (ADR 0311).
    void errors.show(result.error, {
      object: "die Abwesenheitsart",
      reload: result.reload,
    });
  };

  const carried = type.schools.filter((school) => school.carried).length;

  return (
    <SectionCard
      concept={timeTrackingConcept}
      title={type.name}
      titleBadge={
        type.isActive ? undefined : (
          <StatusBadge label="Ausgeschaltet" tone="gray" />
        )
      }
      description={absenceTypeSummary(type)}
      action={
        editing ? undefined : (
          <div className="flex items-center gap-2">
            <Button
              size="md"
              type="button"
              variant="outline"
              className="gap-2"
              tooltip="Öffnet die Felder dieser Art zum Bearbeiten."
              onClick={() => {
                errors.clear();
                setEditing(true);
              }}
            >
              <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
              Bearbeiten
            </Button>
            <OverflowMenu
              ariaLabel={`Weitere Aktionen zu ${type.name}`}
              items={[
                type.isActive
                  ? {
                      label: "Ausschalten",
                      description:
                        toggleWait ??
                        "Sofort an allen Schulen nicht mehr wählbar. Eingetragene Tage behalten den Namen.",
                      icon: (
                        <ProhibitIcon className="size-4" aria-hidden="true" />
                      ),
                      disabled: !toggle.canSubmit,
                      onClick: () =>
                        void switchActive(
                          false,
                          `Die Abwesenheitsart „${type.name}“ ist ausgeschaltet.`,
                        ),
                    }
                  : {
                      label: "Wieder einschalten",
                      description:
                        toggleWait ??
                        "Sofort an allen Schulen wieder wählbar, außer an Schulen, die sie nicht anbieten.",
                      icon: (
                        <ArrowCounterClockwiseIcon
                          className="size-4"
                          aria-hidden="true"
                        />
                      ),
                      disabled: !toggle.canSubmit,
                      onClick: () =>
                        void switchActive(
                          true,
                          `Die Abwesenheitsart „${type.name}“ ist wieder eingeschaltet.`,
                        ),
                    },
              ]}
            />
          </div>
        )
      }
      footer={
        editing ? (
          <EditActions
            onCancel={() => setEditing(false)}
            onSave={() => void save()}
            saving={saving}
            disabled={!edit.canSubmit}
            disabledReason={form.waitReason}
            saveTooltip="Speichert die Art und trägt die Änderung sofort in alle deine Schulen."
          />
        ) : undefined
      }
    >
      {editing ? (
        <div className="space-y-4">
          <LoadErrorAlert error={form.loadError} />
          <FormErrorAlert message={errors.error} />
          {draft ? (
            <AbsenceTypeFields
              idPrefix={`traeger-absence-type-${type.id}`}
              draft={draft}
              onChange={edit.setDraft}
              fieldError={errors.fieldError}
            />
          ) : null}
        </div>
      ) : (
        <div>
          <LoadErrorAlert error={toggleLoadError} className="mb-4" />
          <SectionLabel as="h3" className="mb-2">
            An den Schulen
            <span className="ml-2 font-normal text-gray-500">
              {carried} von {type.schools.length}
            </span>
          </SectionLabel>
          <FramedList>
            {type.schools.map((school) => {
              const badge = schoolDeviationBadge(type, school);
              return (
                <li
                  key={school.schoolId}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                    {school.schoolName}
                  </span>
                  <StatusBadge label={badge.label} tone={badge.tone} />
                </li>
              );
            })}
          </FramedList>
          {carried < type.schools.length ? (
            <p className="mt-2 text-sm text-gray-600">
              Wähle „Bearbeiten“ und „Speichern“. Dann trägt moto die Art auch
              in die übrigen Schulen.
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

export default function TraegerAbsenceTypesPage() {
  const {
    data: list,
    loading,
    error,
    mutate,
    reloadOrThrow,
  } = useTraegerResource(
    traegerStaffKeys.absenceTypes(),
    fetchTraegerAbsenceTypes,
    "die Abwesenheitsarten",
  );
  const [creating, setCreating] = useState(false);
  const { success } = useToast();
  const invalidateFamily = useInvalidateFamily();

  const replace = useCallback(
    (saved: TraegerAbsenceType) => {
      void mutate(
        (current) =>
          current
            ? {
                ...current,
                types: current.types.some((type) => type.id === saved.id)
                  ? current.types.map((type) =>
                      type.id === saved.id ? saved : type,
                    )
                  : [...current.types, saved].sort((a, b) =>
                      a.name.localeCompare(b.name, "de"),
                    ),
              }
            : current,
        { revalidate: false },
      );
      // Eine Art mit Kontingent ändert die Kontingente der Personalakten.
      void invalidateFamily(traegerStaffKeys.absenceAccountsFamily);
    },
    [mutate, invalidateFamily],
  );

  const withAllowance = useMemo(
    () => list?.types.filter((type) => type.allowanceEnabled).length ?? 0,
    [list],
  );
  const released = list?.released ?? false;

  if (list && !released) {
    return (
      <StaffNotReleasedPage
        title="Abwesenheitsarten"
        description="Bis zur Freischaltung legt jede Schule ihre Abwesenheitsarten selbst an."
      />
    );
  }

  return (
    <TenantPage
      title="Abwesenheitsarten"
      info={INFO}
      stats={
        list ? (
          <TenantPageStats
            items={[
              {
                value: list.types.length,
                label: list.types.length === 1 ? "Art" : "Arten",
              },
              { value: withAllowance, label: "mit Kontingent" },
              {
                value: list.schoolCount,
                label: list.schoolCount === 1 ? "Schule" : "Schulen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={error}
      loading={loading}
      actions={
        list ? (
          <Button
            type="button"
            size="md"
            variant="primary"
            className="gap-2"
            tooltip="Öffnet ein Formular für eine neue Abwesenheitsart deines Trägers."
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Abwesenheitsart anlegen
          </Button>
        ) : undefined
      }
      empty={
        list && list.types.length === 0
          ? {
              title: "Noch keine eigene Abwesenheitsart.",
              description:
                "Lege oben eine Art an, zum Beispiel Regenerationstag. Hat eine Schule schon eine eigene Art mit demselben Namen, wird sie Teil deiner Art, mit allen Buchungen.",
            }
          : undefined
      }
      overlays={
        <CreateAbsenceTypeModal
          isOpen={creating}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            replace(created);
            success(
              `Die Abwesenheitsart „${created.name}“ ist angelegt. Alle Schulen sehen sie.`,
            );
          }}
        />
      }
    >
      {/* Equal absence type cards in a grid: grids do not grow (TenantPage
          body rule), so the last type keeps its height like its siblings. */}
      {list && list.types.length > 0 ? (
        <div className="compact:gap-4 grid gap-6 max-sm:gap-3">
          {list.types.map((type) => (
            <AbsenceTypeCard
              key={type.id}
              type={type}
              reload={async () => (await reloadOrThrow()).types}
              onSaved={(saved, message) => {
                replace(saved);
                if (message) success(message);
              }}
            />
          ))}
        </div>
      ) : null}
    </TenantPage>
  );
}
