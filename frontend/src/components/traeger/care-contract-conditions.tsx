"use client";

// Vertragsbedingungen je Angebot (#4678): Laufzeit, Kündigungsfrist,
// Sonderkündigung, Satzung und Vertragspartner. Links die Angebote der
// Schulen des Trägers, rechts die Bedingungen des gewählten Angebots
// (`MasterDetailLayout`, Auswahl in der Adresse, #7409). Ein neuer Vertrag
// übernimmt sie; ein bestehender behält seine.

import { Check, Copy, MousePointer2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DatabaseDetailHeader } from "~/components/database/database-detail-header";
import {
  GroupedList,
  type GroupDefinition,
} from "~/components/database/grouped-list";
import { MasterDetailLayout } from "~/components/database/master-detail-layout";
import { ConfirmationModal } from "~/components/ui/modal";
import { CustomSelect } from "~/components/ui/custom-select";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { ListRowLink } from "~/components/ui/list-row-link";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { Textarea } from "~/components/ui/textarea";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { useClipboardCopy } from "~/lib/use-clipboard-copy";
import { BELOW_MD, BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { careContractsConcept } from "~/lib/concepts/careContracts";
import { createLogger } from "~/lib/logger";
import {
  type ContractNoticeTo,
  type ContractTermKind,
  type ContractTerms,
  type OfferingTemplate,
  saveContractTemplate,
} from "~/lib/traeger-care-contracts-api";
import { formatEuro } from "./contribution-format";
import { NOTICE_TO_LABELS } from "./care-contract-format";

const logger = createLogger({ component: "CareContractConditions" });

// moto offers a special termination only to the half year (31 January,
// 31 July), with the notice months of the terms (#4682). The text names the
// cases; a date in it changes no termination date (#6349).
const SPECIAL_TERMINATION_HINT =
  "Der Vertrag endet dann zum 31. Januar oder 31. Juli. Es gilt dieselbe Frist in Monaten. Ein anderes Datum in diesem Text ändert den Termin nicht.";

/** The suggestion for an offering without conditions: the usual OGS contract. */
export const DEFAULT_TERMS: ContractTerms = {
  termKind: "school_year",
  termMonths: null,
  noticeMonths: 1,
  noticeTo: "month_end",
  specialTermination: false,
  specialTerminationNote: "",
  statuteRequired: false,
  statuteTitle: "",
  statuteUrl: "",
  contractPartner: "",
};

const TERM_ITEMS: readonly { value: ContractTermKind; label: string }[] = [
  { value: "school_year", label: "Bis Schuljahresende" },
  { value: "open_ended", label: "Unbefristet" },
  { value: "fixed_months", label: "Feste Monate" },
];

const NOTICE_OPTIONS = (
  Object.entries(NOTICE_TO_LABELS) as [ContractNoticeTo, string][]
).map(([value, label]) => ({ value, label }));

function offeringKey(offering: OfferingTemplate): string {
  return `${offering.schoolId}-${offering.offeringId}`;
}

function termsOf(offering: OfferingTemplate | undefined): ContractTerms {
  if (!offering?.template) return DEFAULT_TERMS;
  const { id: _id, updatedAt: _updatedAt, ...terms } = offering.template;
  return terms;
}

/** A switch the open form must confirm first: another offering or none. */
interface PendingChoice {
  readonly key: string | null;
}

/**
 * The offerings of the schools on the left, the conditions of the chosen one
 * on the right (`MasterDetailLayout`, #7409). The choice stands in the
 * address (`?angebot=`), so an offering can be linked; the page reads and
 * writes it. This pane is the only view of an offering's conditions.
 */
export function CareContractConditions({
  offerings,
  selectedKey,
  onSelect,
  onSaved,
}: Readonly<{
  offerings: readonly OfferingTemplate[];
  /** The offering in the address, `<schoolId>-<offeringId>`. */
  selectedKey: string | null;
  /** Writes the choice into the address; `null` closes it. */
  onSelect: (key: string | null) => void;
  onSaved: (offering: OfferingTemplate) => void;
}>) {
  const isMobile = useMediaQuery(BELOW_MD);
  const firstOpen = useMemo(
    () =>
      offerings.find((offering) => offering.active && !offering.template) ??
      offerings[0],
    [offerings],
  );
  // Without a choice in the address the desktop opens the first offering
  // still without conditions; a phone shows the list first, since the
  // conditions open over it.
  const shownKey =
    selectedKey ?? (isMobile || !firstOpen ? null : offeringKey(firstOpen));
  const selected =
    shownKey === null
      ? undefined
      : offerings.find((offering) => offeringKey(offering) === shownKey);
  // The open form reports unsaved changes; switching the offer then asks
  // first, because the form of another offer starts from its saved terms.
  const [dirty, setDirty] = useState(false);
  // While the open form saves, the offers stay put: the answer belongs to
  // this form, and switching would drop it or its error.
  const [formSaving, setFormSaving] = useState(false);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const choose = (key: string | null) => {
    if (key === shownKey || formSaving) return;
    if (dirty) setPending({ key });
    else onSelect(key);
  };
  if (offerings.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          title="Deine Schulen haben noch kein Betreuungsangebot."
          description="Die Schulen legen ihre Angebote unter „Anmeldung“ an. Danach legst du hier die Vertragsbedingungen fest."
        />
      </SectionCard>
    );
  }

  const groups: GroupDefinition<OfferingTemplate>[] = [
    ...new Set(offerings.map((offering) => offering.schoolName)),
  ].map((school) => ({
    id: school,
    title: school,
    items: offerings.filter((offering) => offering.schoolName === school),
  }));

  const list = (
    <div className="flex h-full flex-col">
      <p className="border-b border-gray-100 px-4 py-3 text-sm text-gray-600">
        Wähle ein Angebot. Seine Bedingungen gelten für jeden neuen Vertrag.
      </p>
      <GroupedList
        groups={groups}
        keyFor={offeringKey}
        renderItem={(offering) => {
          const key = offeringKey(offering);
          const facts = [
            offering.phaseName,
            offering.priceCents === null
              ? null
              : `${formatEuro(offering.priceCents)} im Monat`,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <ListRowLink
              title={offering.offeringName}
              subtitle={
                <>
                  {facts ? <span className="block">{facts}</span> : null}
                  {offering.template ? (
                    <span className="block">
                      {offering.termText} · {offering.noticeText}
                    </span>
                  ) : null}
                </>
              }
              wrapSubtitle
              badge={<StatusBadge {...conditionBadge(offering)} />}
              selected={key === shownKey}
              disabled={formSaving && key !== shownKey}
              className="border-b border-gray-100 py-2.5"
              onClick={() => choose(key)}
            />
          );
        }}
      />
    </div>
  );

  const detail = selected ? (
    <ConditionsForm
      key={shownKey}
      offering={selected}
      onSaved={onSaved}
      onDirtyChange={setDirty}
      onSavingChange={setFormSaving}
    />
  ) : (
    <EmptyState
      icon={<MousePointer2 className="h-10 w-10" aria-hidden="true" />}
      titleAs="h3"
      title="Kein Angebot ausgewählt"
      description="Wähle links ein Angebot, um seine Bedingungen festzulegen."
      className="h-full justify-center px-12"
    />
  );

  return (
    <>
      <MasterDetailLayout
        list={list}
        detail={detail}
        selectedId={selected ? shownKey : null}
        onDeselect={() => choose(null)}
        mobileDrawerTitle={selected?.offeringName ?? "Angebot"}
      />
      <ConfirmationModal
        isOpen={pending !== null}
        title="Änderungen verwerfen?"
        confirmText="Änderungen verwerfen"
        cancelText="Weiter bearbeiten"
        confirmVariant="warning"
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) onSelect(pending.key);
          setDirty(false);
          setPending(null);
        }}
      >
        <p className="text-sm text-gray-700">
          Die Bedingungen für „{selected?.offeringName}“ sind noch nicht
          gespeichert. Wenn du ein anderes Angebot öffnest, gehen die Änderungen
          verloren.
        </p>
      </ConfirmationModal>
    </>
  );
}

function ConditionsForm({
  offering,
  onSaved,
  onDirtyChange,
  onSavingChange,
}: Readonly<{
  offering: OfferingTemplate;
  onSaved: (offering: OfferingTemplate) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}>) {
  const selected = offering;
  const [draft, setDraft] = useState<ContractTerms>(() => termsOf(offering));
  const dirty = JSON.stringify(draft) !== JSON.stringify(termsOf(offering));
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const [saving, setSaving] = useState(false);
  const isPhone = useMediaQuery(BELOW_SM);
  useEffect(() => {
    onSavingChange(saving);
  }, [saving, onSavingChange]);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();

  const set = <K extends keyof ContractTerms>(
    key: K,
    value: ContractTerms[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    formErrors.clear();
    setSaving(true);
    try {
      const saved = await saveContractTemplate(
        selected.schoolId,
        selected.offeringId,
        draft,
      );
      onSaved(saved);
      success(
        `Die Vertragsbedingungen für „${saved.offeringName}“ sind gespeichert.`,
      );
    } catch (err) {
      logger.error("care_contract_conditions_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void formErrors.show(err, {
        object: "die Änderung der Vertragsbedingungen",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200">
        <DatabaseDetailHeader
          icon={
            <MotoDuotoneIcon
              icon={careContractsConcept.icon}
              tone={careContractsConcept.tone}
              size={36}
            />
          }
          title={selected.offeringName}
          subtitle={selected.schoolName}
        />
      </div>
      <form
        ref={formRef}
        noValidate
        className="min-h-0 flex-1 space-y-6 overflow-auto p-6 max-sm:p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-gray-600">
          Gilt für neue Verträge; bestehende behalten ihre Bedingungen.
        </p>
        <FormErrorAlert message={formErrors.error} />
        <ContractTermsFields
          draft={draft}
          set={set}
          fieldError={formErrors.fieldError}
        />
        {/* What all texts below share stands once (shared text once). */}
        {selected.acceptanceText ||
        selected.withdrawalText ||
        selected.earlyStartText ? (
          <p className="text-sm text-gray-600">
            Die Texte unten sprechen die Eltern an. Die Schule übernimmt sie
            unverändert ins Anmeldeformular.
          </p>
        ) : null}
        {selected.acceptanceText ? (
          <CopyableLegalText
            id="care-contract-acceptance-text"
            label="Gespeicherter Text für das Anmeldeformular"
            rows={8}
            value={selected.acceptanceText}
            hint="So kommt er ins Anmeldeformular: 1. Du speicherst die Bedingungen. 2. Die Schule kopiert den Text unverändert in „Rechtstext / Erklärung“ und setzt „Muss bestätigt werden“. Bestehende Rechtstexte bleiben. Änderst du die Bedingungen später, ersetzt die Schule nur diesen Text."
          />
        ) : null}
        {selected.withdrawalText ? (
          <CopyableLegalText
            id="care-contract-withdrawal-text"
            label="Widerrufsbelehrung für das Anmeldeformular"
            rows={6}
            value={selected.withdrawalText}
            hint="Wer online anmeldet, hat 14 Tage Widerrufsrecht. Die Schule kopiert ihn als eigenen Rechtstext ins Anmeldeformular und setzt „Muss bestätigt werden“. Das Vertrags-PDF enthält ihn immer."
          />
        ) : null}
        {selected.earlyStartText ? (
          <CopyableLegalText
            id="care-contract-early-start-text"
            label="Häkchen „Betreuung vor Ende der Widerrufsfrist“"
            rows={4}
            value={selected.earlyStartText}
            hint="Die Schule kopiert ihn als weiteren Rechtstext ins Anmeldeformular, ohne „Muss bestätigt werden“. Setzen die Eltern das Häkchen, steht es im Vertrag. Beginnt die Betreuung in der Frist, zahlen sie nach einem Widerruf die Tage bis dahin."
          />
        ) : null}
      </form>
      {/* On the desktop the save stays in view: the long legal texts scroll
          in the form above it. On a phone the drawer scrolls as a whole. */}
      <div className="border-t border-gray-100 px-6 py-4 max-sm:px-4">
        <EditActions
          onCancel={() => {
            setDraft(termsOf(selected));
            clearErrors();
          }}
          onSave={() => formRef.current?.requestSubmit()}
          saving={saving}
          cancelDisabled={!dirty}
          // Unchanged conditions have nothing to save; an offering without
          // conditions saves the shown ones as they stand.
          disabled={Boolean(selected.template) && !dirty}
          saveLabel="Bedingungen speichern"
          // A phone keeps both buttons on one line under the legal texts.
          cancelLabel={isPhone ? "Verwerfen" : "Änderungen verwerfen"}
        />
      </div>
    </div>
  );
}

/**
 * Laufzeit, Kündigung, Sonderkündigung, Satzung und Vertragspartner. Die
 * Bedingungen eines Schulangebots und die Vertragsvorlage eines
 * Trägerangebots (#4704) teilen dieselben Felder.
 */
export function ContractTermsFields({
  draft,
  set,
  fieldError,
}: Readonly<{
  draft: ContractTerms;
  set: <K extends keyof ContractTerms>(key: K, value: ContractTerms[K]) => void;
  fieldError: (name: string) => string | undefined;
}>) {
  const formErrors = { fieldError };
  return (
    <>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-900">Laufzeit</legend>
        <CustomSelect
          id="care-contract-term-kind"
          name="term_kind"
          options={TERM_ITEMS}
          value={draft.termKind}
          onChange={(value) => set("termKind", value as ContractTermKind)}
          error={formErrors.fieldError("term_kind")}
          ariaLabel="Laufzeit"
        />
        {draft.termKind === "fixed_months" ? (
          <Input
            controlSize="compact"
            name="term_months"
            label="Anzahl der Monate"
            type="number"
            min={1}
            max={48}
            inputMode="numeric"
            value={draft.termMonths ?? ""}
            error={formErrors.fieldError("term_months")}
            onChange={(event) =>
              set(
                "termMonths",
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
          />
        ) : null}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <legend className="mb-3 text-sm font-medium text-gray-900">
          Kündigung
        </legend>
        <Input
          controlSize="compact"
          name="notice_months"
          label="Frist in Monaten"
          type="number"
          min={0}
          max={12}
          inputMode="numeric"
          value={draft.noticeMonths}
          error={formErrors.fieldError("notice_months")}
          onChange={(event) =>
            set("noticeMonths", Number(event.target.value || 0))
          }
        />
        <CustomSelect
          id="care-contract-notice-to"
          name="notice_to"
          label="Kündigung wirkt"
          value={draft.noticeTo}
          options={NOTICE_OPTIONS}
          error={formErrors.fieldError("notice_to")}
          onChange={(value) => set("noticeTo", value as ContractNoticeTo)}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-900">
          Sonderkündigung
        </legend>
        <label
          htmlFor="care-contract-special-termination"
          className="flex items-center gap-3 text-sm text-gray-800"
        >
          <Checkbox
            id="care-contract-special-termination"
            checked={draft.specialTermination}
            onChange={() =>
              set("specialTermination", !draft.specialTermination)
            }
          />
          Eltern dürfen in besonderen Fällen zum Halbjahr kündigen
        </label>
        {draft.specialTermination ? (
          <Textarea
            name="special_termination_note"
            label="In welchen Fällen?"
            hint={SPECIAL_TERMINATION_HINT}
            required
            rows={3}
            maxLength={1000}
            value={draft.specialTerminationNote}
            error={formErrors.fieldError("special_termination_note")}
            placeholder="Zum Beispiel bei Umzug oder Schulwechsel."
            onChange={(event) =>
              set("specialTerminationNote", event.target.value)
            }
          />
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-900">Satzung</legend>
        <label
          htmlFor="care-contract-statute"
          className="flex items-center gap-3 text-sm text-gray-800"
        >
          <Checkbox
            id="care-contract-statute"
            checked={draft.statuteRequired}
            onChange={() => set("statuteRequired", !draft.statuteRequired)}
          />
          Eltern erkennen mit dem Vertrag eine Satzung an
        </label>
        {draft.statuteRequired ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              controlSize="compact"
              name="statute_title"
              label="Name der Satzung"
              required
              maxLength={200}
              value={draft.statuteTitle}
              error={formErrors.fieldError("statute_title")}
              placeholder="Satzung über die Elternbeiträge"
              onChange={(event) => set("statuteTitle", event.target.value)}
            />
            <Input
              controlSize="compact"
              name="statute_url"
              label="Link zur Satzung (freiwillig)"
              type="url"
              maxLength={500}
              value={draft.statuteUrl}
              error={formErrors.fieldError("statute_url")}
              placeholder="https://"
              onChange={(event) => set("statuteUrl", event.target.value)}
            />
          </div>
        ) : null}
      </fieldset>

      <Input
        controlSize="compact"
        name="contract_partner"
        label="Vertragspartner"
        maxLength={300}
        value={draft.contractPartner}
        error={formErrors.fieldError("contract_partner")}
        placeholder="Name des Vertragspartners"
        onChange={(event) => set("contractPartner", event.target.value)}
      />
      <p className="text-sm text-gray-600">
        Leer lassen, wenn der Name im Briefkopf steht. Sonst trägst du den
        Vertragspartner hier ein. Für „Bei der Annahme“ trägst du ihn immer ein.
      </p>
    </>
  );
}

/**
 * A read-only text the school copies into its enrollment form, with a button
 * that copies it: retyping a legal text invites mistakes.
 */
function CopyableLegalText({
  id,
  label,
  rows,
  value,
  hint,
}: Readonly<{
  id: string;
  label: string;
  rows: number;
  value: string;
  hint: string;
}>) {
  const { success } = useToast();
  const { showMessage } = useApiErrorDisplay();
  const { copied, copy } = useClipboardCopy(
    `CareContractConditions-${id}`,
    2000,
  );
  return (
    <div className="space-y-2">
      {/* A fixed height that scrolls: the few conditions to edit stay in
          view, and the copy button copies the whole text at once. */}
      <Textarea
        id={id}
        label={label}
        readOnly
        rows={rows}
        value={value}
        hint={hint}
      />
      <Button
        type="button"
        variant={copied ? "success" : "outline"}
        size="compact"
        className="gap-1.5"
        aria-describedby={id}
        tooltip="Kopiert den Text, damit du ihn woanders einfügst."
        onClick={async () => {
          if (await copy(value)) success("Der Text ist kopiert.");
          else
            showMessage(
              "Der Text ließ sich nicht kopieren. Markiere ihn und kopiere ihn selbst.",
            );
        }}
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        {copied ? "Kopiert" : "Text kopieren"}
      </Button>
    </div>
  );
}

function conditionBadge(offering: OfferingTemplate): {
  tone: "green" | "gray" | "warning";
  label: string;
} {
  if (offering.template) return { tone: "green", label: "Festgelegt" };
  if (!offering.active) return { tone: "gray", label: "Nicht aktiv" };
  return { tone: "warning", label: "Fehlt" };
}
