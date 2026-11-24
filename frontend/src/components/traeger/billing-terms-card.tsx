"use client";

// Zahlung und Rechnungen je Leistung (#4689): Zahlungsweg, Zahlungsziel in
// Tagen und ob die Leistung auf der Rechnung einer anderen steht. Nur das
// Mittagessen kann auf der Rechnung der Betreuung stehen; die Ferien haben
// immer eine eigene Rechnung. Geändert wird im Dialog je Leistung; die
// Änderung gilt ab dem nächsten Lauf, ausgestellte Rechnungen bleiben.

import { useEffect, useRef, useState } from "react";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { Radio } from "~/components/ui/radio";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EditActions } from "~/components/ui/edit-actions";
import { FieldLabel } from "~/components/ui/field-label";
import { FormModal } from "~/components/ui/form-modal";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  type BillingService,
  type BillingTerms,
  MAX_DUE_DAYS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type ServiceTerms,
  saveServiceTerms,
} from "~/lib/traeger-billing-terms-api";
import {
  BILLING_SERVICE_LABELS,
  PAYMENT_METHOD_LABELS,
  bundleLabel,
  dueDaysLabel,
} from "./billing-payment-format";
import { labelOf } from "~/lib/label-of";

const logger = createLogger({ component: "BillingTermsCard" });

interface TermsRow {
  readonly terms: ServiceTerms;
  /** The services whose invoice may carry this one. */
  readonly options: readonly string[];
  /** Whether another service may travel on this one's invoice. */
  readonly carries: boolean;
}

function rowsOf(data: BillingTerms): TermsRow[] {
  return data.services.flatMap((option) => {
    const terms = data.terms.find((entry) => entry.service === option.service);
    const carries = data.services.some((other) =>
      other.bundleWith.includes(option.service),
    );
    return terms ? [{ terms, options: option.bundleWith, carries }] : [];
  });
}

/** Checks the payment term the form holds: whole days from 0 to 120. */
export function parseDueDays(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days <= MAX_DUE_DAYS ? days : null;
}

interface TermsDraft {
  /** null: the stored method is one this build does not know. */
  readonly method: PaymentMethod | null;
  readonly days: string;
  readonly bundleWith: string;
}

function termsDraft(terms: ServiceTerms): TermsDraft {
  return {
    method: terms.paymentMethod ?? null,
    days: String(terms.dueDays),
    bundleWith: terms.bundleWith,
  };
}

function ServiceTermsModal({
  row,
  data,
  reload,
  onClose,
  onSaved,
}: Readonly<{
  /** The service to change; null keeps the dialog closed. */
  row: TermsRow | null;
  /** The stored terms as the card shows them. */
  data: BillingTerms;
  /** Reads the terms again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<BillingTerms>;
  onClose: () => void;
  onSaved: (data: BillingTerms) => void;
}>) {
  const save = useFormModalPending(row !== null);
  const saving = save.pending;
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();

  useEffect(() => {
    if (row) clearErrors();
  }, [row, clearErrors]);

  const service: BillingService = row?.terms.service ?? "care";
  const label = BILLING_SERVICE_LABELS[service];
  const termsOf = (read: BillingTerms) =>
    read.terms.find((entry) => entry.service === service);

  // The terms rest on the ones read (ADR 0311): a newer read refills the
  // form only while untouched, the save sends their version, and after a
  // refusal the stored terms show.
  const edit = useDraftOn<ServiceTerms, TermsDraft, string, ServiceTerms>(
    {
      opening: row ? service : null,
      data: termsOf(data),
      reload: async () => {
        const found = termsOf(await reload());
        if (!found) throw new Error("service terms are gone");
        return found;
      },
    },
    {
      token: (terms) => terms.version,
      toDraft: termsDraft,
      answer: (saved) => saved,
    },
  );
  const form = useReadDraftForm(edit, formErrors, "die Zahlung");
  const draft = edit.draft ?? (row ? termsDraft(row.terms) : null);
  const method = draft?.method ?? null;
  const days = draft?.days ?? "";
  const bundleWith = draft?.bundleWith ?? "";
  const setMethod = (next: PaymentMethod | null) =>
    edit.setDraft((current) => ({ ...current, method: next }));
  const setDays = (next: string) =>
    edit.setDraft((current) => ({ ...current, days: next }));
  const setBundleWith = (next: string) =>
    edit.setDraft((current) => ({ ...current, bundleWith: next }));

  const submit = async () => {
    // Enter submits too: nothing goes out before the stored terms are
    // read, and the shown error stays.
    if (!row || !form.begin()) return;
    const dueDays = parseDueDays(days);
    if (dueDays === null) {
      formErrors.invalid("Bitte prüfe deine Angaben.", {
        due_days: `Bitte eine ganze Zahl von 0 bis ${MAX_DUE_DAYS} eingeben.`,
      });
      return;
    }
    if (method === null) {
      formErrors.invalid("Bitte wähle aus, wie die Familien zahlen.", {});
      return;
    }
    await save.run(async (op) => {
      let saved: BillingTerms | undefined;
      const result = await edit.submit(async (version) => {
        saved = await saveServiceTerms(
          service,
          {
            paymentMethod: method,
            dueDays,
            bundleWith: row.options.length > 0 ? bundleWith : "",
          },
          version,
        );
        return termsOf(saved) ?? row.terms;
      });
      if (result.ok && saved) {
        success(`Die Zahlung für „${label}“ ist gespeichert.`);
        if (op.isCurrent()) onSaved(saved);
        return;
      }
      if (result.ok) return;
      logger.error("billing_terms_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      if (!op.isCurrent()) return;
      // Changed since it was read: `reload` shows the stored terms instead
      // of the draft, without a retry (ADR 0311).
      void formErrors.show(result.error, {
        object: "die Zahlung",
        reload: result.reload,
      });
    });
  };

  return (
    <FormModal
      isOpen={row !== null}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title={`Zahlung: ${label}`}
      size="md"
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={saving}
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LoadErrorAlert error={form.loadError} />
        <div className="space-y-2">
          <FieldLabel>Zahlungsweg</FieldLabel>
          <SegmentedControl
            ariaLabel="Zahlungsweg"
            items={PAYMENT_METHODS.map((value) => ({
              value,
              label: PAYMENT_METHOD_LABELS[value],
            }))}
            value={method}
            onChange={setMethod}
          />
          <p className="text-sm text-gray-600">
            {method === "direct_debit"
              ? "Du buchst den Betrag ab. Dafür braucht die Familie ein SEPA-Mandat bei dir."
              : "Die Familie überweist den Betrag selbst."}
          </p>
        </div>
        <Input
          controlSize="compact"
          id={`billing-terms-days-${service}`}
          name="due_days"
          label="Zahlungsziel in Tagen"
          required
          inputMode="numeric"
          value={days}
          maxLength={3}
          hint={`Tage nach dem Rechnungsdatum, 0 bis ${MAX_DUE_DAYS}. Gilt, wenn der Lauf kein eigenes Datum hat.`}
          error={formErrors.fieldError("due_days") ?? undefined}
          onChange={(event) => setDays(event.target.value)}
        />
        {row && row.options.length > 0 ? (
          <div className="space-y-2">
            <FieldLabel id="billing-terms-bundle-label">Rechnung</FieldLabel>
            <div
              role="radiogroup"
              aria-labelledby="billing-terms-bundle-label"
              className="grid gap-2 sm:grid-cols-2"
            >
              {[
                { value: "care", label: "Auf der Rechnung der Betreuung" },
                { value: "", label: "Eigene Rechnung" },
              ].map((item) => (
                <ChoiceTile
                  key={item.value}
                  selected={bundleWith === item.value}
                >
                  <Radio
                    name="billing-terms-bundle"
                    value={item.value}
                    checked={bundleWith === item.value}
                    onChange={() => setBundleWith(item.value)}
                  />
                  {item.label}
                </ChoiceTile>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            {service === "holiday"
              ? "Die Ferienbetreuung hat immer eine eigene Rechnung."
              : "Die Betreuung hat immer eine eigene Rechnung."}
          </p>
        )}
        <p className="text-sm text-gray-600">
          Das gilt ab dem nächsten Lauf. Ausgestellte Rechnungen bleiben, wie
          sie sind.
        </p>
      </form>
    </FormModal>
  );
}

export function BillingTermsCard({
  data,
  onChanged,
  reload,
  write,
}: Readonly<{
  data: BillingTerms;
  onChanged: () => Promise<unknown>;
  /** Reads the terms again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<BillingTerms>;
  /**
   * Hands the terms a save answered to the read (ADR 0311, rule 5): the
   * next change sends their version even when reading all defaults fails.
   */
  write: (terms: BillingTerms) => Promise<unknown>;
}>) {
  const [editing, setEditing] = useState<TermsRow | null>(null);
  const rows = rowsOf(data);

  const columns: DataTableColumn<TermsRow>[] = [
    {
      key: "service",
      header: "Leistung",
      stacked: "title",
      render: ({ terms }) => (
        <span className="font-medium text-gray-900">
          {BILLING_SERVICE_LABELS[terms.service]}
        </span>
      ),
    },
    {
      key: "method",
      header: "Zahlungsweg",
      stacked: "field",
      render: ({ terms }) =>
        labelOf(PAYMENT_METHOD_LABELS, terms.paymentMethod, "–"),
    },
    {
      key: "days",
      header: "Zahlungsziel",
      stacked: "field",
      render: ({ terms }) => (
        <span className="tabular-nums">{dueDaysLabel(terms.dueDays)}</span>
      ),
    },
    {
      key: "bundle",
      header: "Rechnung",
      stacked: "field",
      render: ({ terms, options, carries }) =>
        bundleLabel(terms.bundleWith, options, carries),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      stacked: "meta",
      stackedLabel: false,
      render: (row) => (
        <OverflowMenu
          ariaLabel={`Aktionen für ${BILLING_SERVICE_LABELS[row.terms.service]}`}
          items={[
            {
              label: "Bearbeiten",
              description:
                "Öffnet Zahlung und Rechnung dieser Leistung zum Ändern.",
              onClick: () => setEditing(row),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <SectionCard
      title="Zahlung und Rechnungen"
      description="So zahlen die Familien je Leistung, und was auf einer Rechnung steht. Änderungen gelten ab dem nächsten Lauf."
      overflow="visible"
    >
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.terms.service}
        onRowClick={setEditing}
        rowHasInteractiveControls
      />
      <ServiceTermsModal
        row={editing}
        data={data}
        reload={reload}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          void write(saved);
          void onChanged();
        }}
      />
    </SectionCard>
  );
}
