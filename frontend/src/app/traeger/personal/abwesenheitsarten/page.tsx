"use client";

// Abwesenheitsarten des Trägers (#4710, ADR 0089 §10 mit Nachtrag, ADR 0235).
// Die Personalverwaltung legt Arten wie Regenerationstag an, mit Kontingent je
// Person und Jahr über alle Schulen. moto trägt jede Art in jede Schule; eine
// Schule darf nur für ihre Einsätze abweichen. Die Karte jeder Art zeigt
// deshalb, wie jede Schule sie führt.

import {
  LockKeyIcon,
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
import { Button } from "~/components/ui/button";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
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
  useApiLoadError,
  useToast,
} from "~/contexts/ToastContext";
import { timeTrackingConcept } from "~/lib/concepts/timeTracking";
import { createLogger } from "~/lib/logger";
import {
  createTraegerAbsenceType,
  fetchTraegerAbsenceTypes,
  updateTraegerAbsenceType,
  type TraegerAbsenceType,
  type TraegerAbsenceTypeList,
} from "~/lib/traeger-absence-api";

const logger = createLogger({ component: "TraegerAbsenceTypesPage" });

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const INFO = (
  <div className="space-y-2">
    <p>
      Hier legen Sie eigene Arten an, etwa Regenerationstag oder Umwandlungstag.
      Urlaub, Krank, Fortbildung, Sonstige und Freizeitausgleich gibt es immer.
    </p>
    <p>
      moto trägt jede Art in jede Ihrer Schulen. Eine Schule darf abweichen, nur
      für ihre eigenen Einsätze: Sie bietet die Art nicht an, oder sie erlaubt
      weniger Tage. Mehr als das Kontingent erlaubt keine Schule.
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
      errors.invalid("Bitte prüfen Sie die markierten Felder.", invalid);
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
          saveTooltip="Legt die Art an und trägt sie sofort in alle Ihre Schulen."
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
  onSaved,
}: Readonly<{
  type: TraegerAbsenceType;
  onSaved: (type: TraegerAbsenceType, message: string) => void;
}>) {
  const [draft, setDraft] = useState<AbsenceTypeDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const display = useApiErrorDisplay();

  const write = async (next: AbsenceTypeDraft, message: string) => {
    setSaving(true);
    try {
      const saved = await updateTraegerAbsenceType(type.id, next);
      setDraft(null);
      onSaved(saved, message);
    } catch (err) {
      logger.error("traeger_absence_type_update_failed", {
        error: errorMessage(err),
      });
      if (draft) void errors.show(err, { object: "die Abwesenheitsart" });
      else void display.show(err, { object: "die Abwesenheitsart" });
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!draft) return;
    const invalid = absenceTypeDraftErrors(draft);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfen Sie die markierten Felder.", invalid);
      return;
    }
    void write(
      draft,
      `Die Abwesenheitsart „${draft.name.trim()}“ ist gespeichert. Alle Schulen sehen sie.`,
    );
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
        draft ? undefined : (
          <div className="flex items-center gap-2">
            <Button
              size="md"
              type="button"
              variant="outline"
              className="gap-2"
              tooltip="Öffnet die Felder dieser Art zum Ändern."
              onClick={() => {
                errors.clear();
                setDraft(draftOf(type));
              }}
            >
              <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
              Ändern
            </Button>
            <OverflowMenu
              ariaLabel={`Weitere Aktionen zu ${type.name}`}
              items={[
                type.isActive
                  ? {
                      label: "Ausschalten",
                      description:
                        "Sofort an allen Schulen nicht mehr wählbar. Eingetragene Tage behalten den Namen.",
                      icon: (
                        <ProhibitIcon className="size-4" aria-hidden="true" />
                      ),
                      onClick: () =>
                        void write(
                          { ...draftOf(type), isActive: false },
                          `Die Abwesenheitsart „${type.name}“ ist ausgeschaltet.`,
                        ),
                    }
                  : {
                      label: "Wieder einschalten",
                      description:
                        "Sofort an allen Schulen wieder wählbar, außer an Schulen, die sie nicht anbieten.",
                      icon: (
                        <ArrowCounterClockwiseIcon
                          className="size-4"
                          aria-hidden="true"
                        />
                      ),
                      onClick: () =>
                        void write(
                          { ...draftOf(type), isActive: true },
                          `Die Abwesenheitsart „${type.name}“ ist wieder eingeschaltet.`,
                        ),
                    },
              ]}
            />
          </div>
        )
      }
      footer={
        draft ? (
          <EditActions
            onCancel={() => setDraft(null)}
            onSave={save}
            saving={saving}
            saveTooltip="Speichert die Art und trägt die Änderung sofort in alle Ihre Schulen."
          />
        ) : undefined
      }
    >
      {draft ? (
        <div className="space-y-4">
          <FormErrorAlert message={errors.error} />
          <AbsenceTypeFields
            idPrefix={`traeger-absence-type-${type.id}`}
            draft={draft}
            onChange={setDraft}
            fieldError={errors.fieldError}
          />
        </div>
      ) : (
        <div>
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
        </div>
      )}
    </SectionCard>
  );
}

export default function TraegerAbsenceTypesPage() {
  const [list, setList] = useState<TraegerAbsenceTypeList | null>(null);
  const [creating, setCreating] = useState(false);
  const pageLoad = useApiLoadError();
  const { show: showLoadError, clear: clearLoadError } = pageLoad;
  const { success } = useToast();

  const load = useCallback(async () => {
    try {
      setList(await fetchTraegerAbsenceTypes());
      clearLoadError();
    } catch (err) {
      logger.error("traeger_absence_types_load_failed", {
        error: errorMessage(err),
      });
      await showLoadError(err, {
        object: "die Abwesenheitsarten",
        retry: () => void load(),
      });
    }
  }, [clearLoadError, showLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = useCallback((saved: TraegerAbsenceType) => {
    setList((current) =>
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
    );
  }, []);

  const withAllowance = useMemo(
    () => list?.types.filter((type) => type.allowanceEnabled).length ?? 0,
    [list],
  );
  const released = list?.released ?? false;

  return (
    <TenantPage
      title="Abwesenheitsarten"
      info={INFO}
      stats={
        list && released ? (
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
      statsLoading={!list && !pageLoad.error}
      error={pageLoad.error}
      loading={!list && !pageLoad.error}
      actions={
        released ? (
          <Button
            type="button"
            size="md"
            variant="primary"
            className="gap-2"
            tooltip="Öffnet ein Formular für eine neue Abwesenheitsart Ihres Trägers."
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Abwesenheitsart
          </Button>
        ) : undefined
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
      {list && !released ? (
        <SectionCard>
          <EmptyState
            icon={<LockKeyIcon className="h-12 w-12" aria-hidden="true" />}
            title="Personal beim Träger ist noch nicht freigeschaltet."
            description="Das moto-Team schaltet es frei. Bis dahin legt jede Schule ihre Abwesenheitsarten selbst an."
          />
        </SectionCard>
      ) : null}

      {list && released && list.types.length === 0 ? (
        <SectionCard>
          <EmptyState
            title="Noch keine eigene Abwesenheitsart."
            description="Legen Sie oben eine Art an, zum Beispiel Regenerationstag. Hat eine Schule schon eine eigene Art mit demselben Namen, wird sie Teil Ihrer Art, mit allen Buchungen."
          />
        </SectionCard>
      ) : null}

      {list && released
        ? list.types.map((type) => (
            <AbsenceTypeCard
              key={type.id}
              type={type}
              onSaved={(saved, message) => {
                replace(saved);
                success(message);
              }}
            />
          ))
        : null}
    </TenantPage>
  );
}
