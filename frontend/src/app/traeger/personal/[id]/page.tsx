"use client";

// Eine Personalakte des Trägers (#4705, ADR 0089): die Person (Name und
// Geburtstag korrigiert die Personalverwaltung, #7379), die
// Personalnummer des Trägers, die Einsatzorte, die Kontingente (#4710), das
// Stundenkonto mit dem Monatsabschluss (#4711), die
// Bank- und Steuerdaten und der Verlauf. Die Personalnummer und die Bankdaten ändert nur die
// Personalverwaltung; die Schulen sehen sie nur noch als „vom Träger“.
// Die Akte ist in Reiter geteilt (#7414); der Reiter steht in der Adresse.

import { EyeIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { staffChangeText } from "~/components/traeger/staff/staff-record-format";
import { StaffPersonCard } from "~/components/traeger/staff/staff-person-card";
import { StaffPersonnelNumberCard } from "~/components/traeger/staff/staff-personnel-number-card";
import { StaffProofsCard } from "~/components/traeger/staff/staff-proofs-card";
import { StaffAbsenceAccountsCard } from "~/components/traeger/staff/staff-absence-accounts-card";
import { useStaffOverviewReturn } from "~/components/traeger/staff/staff-overview-tab";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Button } from "~/components/ui/button";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FramedList } from "~/components/ui/framed-list";
import { Input } from "~/components/ui/input";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage } from "~/components/ui/tenant-page";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { changeHistoryConcept } from "~/lib/concepts/changeHistory";
import { payrollConcept } from "~/lib/concepts/payroll";
import { schoolsConcept } from "~/lib/concepts/schools";
import { staffConcept } from "~/lib/concepts/staff";
import { formatBerlinDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { useInvalidateFamily } from "~/lib/swr";
import { useDraftOn } from "~/lib/swr/read-draft";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  dissolveStaffRecord,
  fetchStaffRecord,
  revealStaffFinancial,
  staffName,
  updateStaffFinancial,
  type StaffFinancial,
  type StaffFinancialValues,
  type StaffRecordDetail,
} from "~/lib/traeger-staff-api";

const logger = createLogger({ component: "TraegerStaffRecordPage" });

/** Was die Seite ist und was man dort zuerst tut (#7595). */
const RECORD_INFO =
  "Hier siehst du die Akte einer Person über alle ihre Schulen. Prüfe unter „Stammdaten“ zuerst die „Personalnummer“ und die „Einsatzorte“. „Verträge und Zeit“, „Nachweise“ und „Bank und Steuer“ findest du in den Reitern daneben.";

/**
 * Was mit einem Einsatzort aus dem Vertretungspool als Nächstes passiert
 * (#7197): Er endet nach der letzten Blockung der Schule, die nächste
 * Blockung nimmt ihn wieder auf.
 */
function poolEmploymentHint(active: boolean): string {
  return active
    ? "Endet nach der letzten Blockung der Schule."
    : "Die nächste Blockung beschäftigt die Person hier wieder.";
}

// Die Arbeitsverträge (#4706) bringen Tabelle, Datumsauswahl und Dialoge mit;
// sie laden nach, damit die Akte selbst klein bleibt.
const StaffContractsCard = dynamic(
  () =>
    import("~/components/traeger/staff/staff-contracts-card").then(
      (module) => module.StaffContractsCard,
    ),
  {
    ssr: false,
    loading: () => <SectionCard title="Arbeitsverträge" loading />,
  },
);

// Das Stundenkonto (#4711) bringt Tabelle und Abschluss-Dialoge mit.
const StaffTimeAccountCard = dynamic(
  () =>
    import("~/components/traeger/staff/staff-time-account-card").then(
      (module) => module.StaffTimeAccountCard,
    ),
  {
    ssr: false,
    loading: () => <SectionCard title="Stundenkonto" loading />,
  },
);

/** Die Reiter der Akte (#7414); `stammdaten` steht ohne `?tab=` in der Adresse. */
const RECORD_TABS = [
  { value: "stammdaten", label: "Stammdaten" },
  { value: "vertraege", label: "Verträge und Zeit" },
  { value: "nachweise", label: "Nachweise" },
  { value: "bank-und-steuer", label: "Bank und Steuer" },
  { value: "verlauf", label: "Verlauf" },
] as const;

type RecordTab = (typeof RECORD_TABS)[number]["value"];

/** Der Reiter in der Adresse; ein unbekannter Wert öffnet die Stammdaten. */
function parseRecordTab(value: string | null | undefined): RecordTab {
  return RECORD_TABS.find((tab) => tab.value === value)?.value ?? "stammdaten";
}

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const FINANCIAL_FIELDS = [
  ["iban", "IBAN", "DE…"],
  ["taxId", "Steuer-ID", "11 Ziffern"],
  ["socialSecurityNumber", "Sozialversicherungsnummer", "12 Zeichen"],
] as const satisfies readonly (readonly [
  keyof StaffFinancial,
  string,
  string,
])[];

const valuesOf = (financial: StaffFinancial): StaffFinancialValues => ({
  iban: financial.iban,
  taxId: financial.taxId,
  socialSecurityNumber: financial.socialSecurityNumber,
});

function FinancialCard({
  record,
  onSaved,
}: Readonly<{ record: StaffRecordDetail; onSaved: () => void }>) {
  const [revealed, setRevealed] = useState<StaffFinancial | null>(null);
  const [revealing, setRevealing] = useState(false);
  // The values the edit opened on, with their version (ADR 0311). Every
  // read of them stands in the schools' access log, so the draft rests on
  // this read and reads again only after a refusal.
  const [opened, setOpened] = useState<StaffFinancial | null>(null);
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const actionErrors = useApiErrorDisplay();
  const { success } = useToast();
  const shown = revealed ?? record.financial;
  const editing = opened !== null;
  const edit = useDraftOn<StaffFinancial, StaffFinancialValues, string, void>(
    {
      opening: editing ? record.id : null,
      data: opened ?? undefined,
      reload: async () => {
        const read = await revealStaffFinancial(record.id);
        setOpened(read);
        return read;
      },
    },
    {
      token: (read) => read.version,
      toDraft: valuesOf,
      // The card closes after a save; the page reads the record again.
      answer: (_saved, base) => base,
    },
  );
  const form = useReadDraftForm(
    editing ? edit : null,
    errors,
    "die Bank- und Steuerdaten",
  );
  const draft = edit.draft ?? (opened ? valuesOf(opened) : null);

  const reveal = async () => {
    setRevealing(true);
    try {
      setRevealed(await revealStaffFinancial(record.id));
    } catch (err) {
      logger.error("traeger_staff_financial_reveal_failed", {
        error: errorMessage(err),
      });
      void actionErrors.show(err, { object: "die Bank- und Steuerdaten" });
    } finally {
      setRevealing(false);
    }
  };

  const startEdit = async () => {
    errors.clear();
    let values = revealed;
    if (!values && record.hasFinancial) {
      try {
        values = await revealStaffFinancial(record.id);
        setRevealed(values);
      } catch (err) {
        logger.error("traeger_staff_financial_reveal_failed", {
          error: errorMessage(err),
        });
        void actionErrors.show(err, { object: "die Bank- und Steuerdaten" });
        return;
      }
    }
    // Without values nothing is opened: the empty section with its version.
    setOpened(values ?? record.financial);
  };

  const close = () => setOpened(null);

  const save = async () => {
    if (!draft || !form.begin()) return;
    const clean = (value: string | null) =>
      value && value.trim() !== "" ? value.trim() : null;
    const values = {
      iban: clean(draft.iban),
      taxId: clean(draft.taxId),
      socialSecurityNumber: clean(draft.socialSecurityNumber),
    };
    setSaving(true);
    const result = await edit.submit((version) =>
      updateStaffFinancial(record.id, values, version),
    );
    setSaving(false);
    if (result.ok) {
      close();
      setRevealed(null);
      success("Die Bank- und Steuerdaten sind gespeichert.");
      onSaved();
      return;
    }
    if (result.skipped) return;
    logger.error("traeger_staff_financial_save_failed", {
      error: errorMessage(result.error),
    });
    // Changed since editing began: the fields show the stored values with
    // the message, without a retry (ADR 0311).
    void errors.show(result.error, {
      object: "die Bank- und Steuerdaten",
      reload: result.reload,
    });
  };

  return (
    <SectionCard
      concept={payrollConcept}
      title="Bank und Steuer"
      description="Nur die Personalverwaltung sieht und ändert diese Werte. Jedes Anzeigen steht im Zugriffsprotokoll der Schulen."
      action={
        editing ? undefined : (
          <span className="flex flex-wrap gap-2">
            {record.hasFinancial && !revealed ? (
              <Button
                size="md"
                type="button"
                variant="outline"
                className="gap-2"
                isLoading={revealing}
                loadingText="Wird geöffnet …"
                tooltip="Zeigt die vollständigen Werte. Das steht im Zugriffsprotokoll der Schulen."
                onClick={() => void reveal()}
              >
                <EyeIcon className="h-4 w-4" aria-hidden="true" />
                Anzeigen
              </Button>
            ) : null}
            <Button
              size="md"
              type="button"
              variant="outline"
              className="gap-2"
              tooltip="Öffnet die Felder für IBAN, Steuer-ID und Sozialversicherungsnummer."
              onClick={() => void startEdit()}
            >
              <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
              Bearbeiten
            </Button>
          </span>
        )
      }
      footer={
        editing ? (
          <EditActions
            onCancel={close}
            onSave={() => void save()}
            saving={saving}
            disabled={!edit.canSubmit}
            disabledReason={form.waitReason}
          />
        ) : undefined
      }
    >
      {editing && draft ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <LoadErrorAlert error={form.loadError} className="sm:col-span-3" />
          {FINANCIAL_FIELDS.map(([key, label, placeholder]) => (
            <Input
              key={key}
              id={`traeger-staff-${key}`}
              label={label}
              controlSize="compact"
              placeholder={placeholder}
              autoComplete="off"
              value={draft[key] ?? ""}
              error={key === "iban" ? errors.error?.message : undefined}
              onChange={(event) =>
                edit.setDraft((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
            />
          ))}
        </div>
      ) : (
        <DataGrid columns={4}>
          {FINANCIAL_FIELDS.map(([key, label]) => (
            <DataField key={key} label={label} mono={Boolean(shown[key])}>
              {shown[key] ?? "Nicht hinterlegt"}
            </DataField>
          ))}
        </DataGrid>
      )}
    </SectionCard>
  );
}

export default function TraegerStaffRecordPage() {
  // `useSearchParams` braucht eine Suspense-Grenze.
  return (
    <Suspense
      fallback={<TenantPage title="Personalakte" info={RECORD_INFO} loading />}
    >
      <StaffRecordContent />
    </Suspense>
  );
}

function StaffRecordContent() {
  const { backHref } = useStaffOverviewReturn();
  const params = useParams<{ id: string }>();
  const recordId = params?.id ?? "";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Der Reiter steht in der Adresse, ein Lesezeichen öffnet ihn wieder
  // (#7414). Ein Klick zeigt ihn sofort, die Adresse folgt; bis dahin gilt
  // der Klick. Ändert sich die Adresse anders (Zurück, ein Link), gewinnt sie.
  const addressedTab = parseRecordTab(searchParams?.get("tab"));
  const [clicked, setClicked] = useState<{
    recordId: string;
    tab: RecordTab;
    from: RecordTab;
  } | null>(null);
  const activeTab =
    clicked && clicked.recordId === recordId && clicked.from === addressedTab
      ? clicked.tab
      : addressedTab;
  useEffect(() => {
    // Der vorgezogene Reiter überbrückt nur das Umschalten der Adresse. Danach
    // darf er eine spätere Navigation im Browser nicht überstimmen.
    setClicked(null);
  }, [addressedTab, recordId]);
  const openTab = (next: RecordTab) => {
    setClicked({ recordId, tab: next, from: addressedTab });
    // `from` (der Rückweg zur Übersicht) bleibt in der Adresse stehen.
    const query = new URLSearchParams(searchParams?.toString());
    if (next === "stammdaten") query.delete("tab");
    else query.set("tab", next);
    const queryString = query.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  };
  const { success } = useToast();
  const {
    data: record,
    loading,
    error,
    mutate,
    reload,
    reloadOrThrow,
  } = useTraegerResource(
    recordId ? traegerStaffKeys.record(recordId) : null,
    () => fetchStaffRecord(recordId),
    "die Personalakte",
  );
  const [confirming, setConfirming] = useState(false);
  const [dissolving, setDissolving] = useState(false);
  const dissolveErrors = useApiFormError();
  const invalidateFamily = useInvalidateFamily();

  // Name, Geburtstag, Personalnummer, Einsatzorte and Bank und Steuer of a
  // record also stand in the list of records.
  const refreshOverview = () =>
    void invalidateFamily(traegerStaffKeys.overviewFamily);
  const replace = (next: StaffRecordDetail) => {
    void mutate(next, { revalidate: false });
    refreshOverview();
  };

  const dissolve = async () => {
    if (!record) return;
    setDissolving(true);
    try {
      await dissolveStaffRecord(record.id);
      refreshOverview();
      success(`Die Akte von ${staffName(record)} ist aufgelöst.`);
      router.push(backHref);
    } catch (err) {
      logger.error("traeger_staff_record_dissolve_failed", {
        error: errorMessage(err),
      });
      void dissolveErrors.show(err, { object: "die Personalakte" });
    } finally {
      setDissolving(false);
    }
  };

  return (
    <TenantPage
      info={RECORD_INFO}
      title={record ? staffName(record) : "Personalakte"}
      leading={<ConceptIconTile concept={staffConcept} size="page" />}
      back
      backHref={backHref}
      backLabel="Zurück zu den Personalakten"
      tabs={
        record
          ? {
              value: activeTab,
              onChange: (next) => openTab(parseRecordTab(next)),
              inUrl: true,
              label: "Bereiche der Personalakte",
              items: RECORD_TABS,
            }
          : undefined
      }
      error={error}
      loading={loading}
      actions={
        record ? (
          <OverflowMenu
            ariaLabel="Weitere Aktionen zur Personalakte"
            items={[
              {
                label: "Akte auflösen",
                description:
                  "moto fragt vorher nach. Die Schulen bekommen ihre Bankdaten zurück.",
                icon: <TrashIcon className="size-4" aria-hidden="true" />,
                destructive: true,
                onClick: () => {
                  dissolveErrors.clear();
                  setConfirming(true);
                },
              },
            ]}
          />
        ) : undefined
      }
      overlays={
        record ? (
          <ConfirmDeleteModal
            isOpen={confirming}
            onClose={() => {
              if (dissolving) return;
              setConfirming(false);
            }}
            onConfirm={() => void dissolve()}
            title="Akte auflösen?"
            description={
              <div className="space-y-3">
                <p>
                  Die Akte von{" "}
                  <span className="font-medium text-gray-900">
                    {staffName(record)}
                  </span>{" "}
                  wird aufgelöst. Danach führt jede Schule die Person wieder
                  selbst.
                </p>
                <p>
                  Jede Schule mit laufender Beschäftigung bekommt die Bank- und
                  Steuerdaten zurück. Die Personalnummer bleibt an den Schulen
                  stehen. Der Verlauf der Akte wird gelöscht.
                </p>
              </div>
            }
            gate={{ mode: "twoStep" }}
            confirmLabel="Akte auflösen"
            loadingLabel="Wird aufgelöst …"
            loading={dissolving}
            error={dissolveErrors.error}
          />
        ) : null
      }
    >
      {record ? (
        <>
          {activeTab === "stammdaten" ? (
            <>
              <StaffPersonCard
                record={record}
                reload={reloadOrThrow}
                onSaved={() => {
                  refreshOverview();
                  return mutate();
                }}
              />
              <div className="compact:gap-4 grid gap-6 max-sm:gap-3 lg:grid-cols-2">
                <StaffPersonnelNumberCard record={record} onSaved={replace} />
                <SectionCard
                  concept={schoolsConcept}
                  title="Einsatzorte"
                  description="An diesen Schulen arbeitet die Person. Jede Schule plant und erfasst ihre Zeiten wie bisher."
                >
                  <FramedList>
                    {record.employments.map((employment) => (
                      <li
                        key={`${employment.schoolId}-${employment.staffId}`}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                              {employment.schoolName}
                            </span>
                            {employment.viaPool ? (
                              <StatusBadge
                                label="Vertretungspool"
                                tone="blue"
                                size="xs"
                              />
                            ) : null}
                          </div>
                          {employment.employerName ? (
                            <p className="mt-0.5 text-sm text-gray-500">
                              Arbeitgeber: {employment.employerName}
                            </p>
                          ) : null}
                          {employment.viaPool ? (
                            <p className="mt-0.5 text-sm text-gray-500">
                              {poolEmploymentHint(employment.active)}
                            </p>
                          ) : null}
                        </div>
                        <StatusBadge
                          label={employment.active ? "Beschäftigt" : "Beendet"}
                          tone={employment.active ? "green" : "gray"}
                        />
                      </li>
                    ))}
                  </FramedList>
                </SectionCard>
              </div>
            </>
          ) : null}

          {activeTab === "vertraege" ? (
            <>
              <StaffContractsCard
                record={record}
                reload={reloadOrThrow}
                onChanged={replace}
              />
              <StaffTimeAccountCard recordId={record.id} />
              <StaffAbsenceAccountsCard recordId={record.id} />
            </>
          ) : null}

          {activeTab === "nachweise" ? (
            <StaffProofsCard
              recordId={record.id}
              personName={staffName(record)}
              proofs={record.proofs}
              onChanged={(proofs) =>
                void mutate(
                  (current) => (current ? { ...current, proofs } : current),
                  { revalidate: false },
                )
              }
            />
          ) : null}

          {activeTab === "bank-und-steuer" ? (
            <FinancialCard
              record={record}
              onSaved={() => {
                reload();
                refreshOverview();
              }}
            />
          ) : null}

          {activeTab === "verlauf" ? (
            <SectionCard
              concept={changeHistoryConcept}
              title="Verlauf"
              description="Woher die Akte kommt, was beim Verknüpfen nicht übernommen wurde und was sich seitdem geändert hat. Bank- und Steuerwerte stehen nur maskiert hier."
            >
              {record.changes.length > 0 ? (
                <FramedList>
                  {record.changes.map((change, index) => (
                    <li
                      key={`${change.occurredAt}-${index}`}
                      className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <span className="min-w-0 text-sm wrap-anywhere text-gray-900">
                        {staffChangeText(change)}
                      </span>
                      <span className="shrink-0 text-sm text-gray-500 tabular-nums">
                        {formatBerlinDate(change.occurredAt)}
                      </span>
                    </li>
                  ))}
                </FramedList>
              ) : (
                <EmptyState title="Noch kein Eintrag." variant="compact" />
              )}
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </TenantPage>
  );
}
