"use client";

// Zahler einer bestätigten Ferienanmeldung ändern (#8158): Bringt die
// Familie den Bescheid erst nach der Bestätigung, wählt das Träger-Büro hier
// neu, wer bezahlt, ohne die Kinder zu stornieren und neu anzumelden. Die
// Karte zeigt vor dem Speichern je Kind, was die Familie und was der
// Kostenträger danach bezahlt. Die Begründung steht im Verlauf der
// Anmeldung. Eine schon ausgestellte Rechnung bleibt, wie sie ist; die Karte
// nennt dann den Weg zum Storno in der Abrechnung.

import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { ButtonLink } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { SpinnerIcon } from "~/components/ui/icons";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { Textarea } from "~/components/ui/textarea";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { contributionsConcept } from "~/lib/concepts/contributions";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useActionOn } from "~/lib/swr/read-draft";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  changeHolidayPayer,
  fetchHolidayPayerChange,
  type HolidayContribution,
  type HolidayPayerChoice,
  type HolidayPayerKind,
  type HolidayPayerPreview,
} from "~/lib/traeger-contributions-api";
import type {
  CostBearerChoice,
  HolidayRegistrationDetail,
} from "~/lib/traeger-holiday-registrations-api";
import { formatEuro } from "./contribution-format";
import {
  HolidayPayerChoiceField,
  holidayPayerOf,
  holidayPayerText,
} from "./holiday-payer-choice";
import { useFreshTraegerResource } from "./use-traeger-resource";

const logger = createLogger({ component: "HolidayPayerEditor" });

/** As the backend bounds the reason (HolidayPayerReasonMaxLength). */
const REASON_MAX_LENGTH = 500;

function sameChoice(a: HolidayPayerChoice, b: HolidayPayerChoice): boolean {
  return (
    a.kind === b.kind &&
    (a.kind !== "cost_bearer" || a.costBearerId === b.costBearerId)
  );
}

/** One amount before and after: „33,75 € → 0,00 €“, or the amount that stays. */
function AmountChange({
  before,
  after,
}: Readonly<{ before: number; after: number }>) {
  if (before === after) {
    return (
      <span className="tabular-nums">
        {formatEuro(after)}{" "}
        <span className="font-normal text-gray-600">(bleibt)</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5 tabular-nums">
      <span className="sr-only">bisher</span>
      <span className="font-normal text-gray-600">{formatEuro(before)}</span>
      <ArrowRight className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
      <span className="sr-only">neu</span>
      <span className="font-semibold text-gray-900">{formatEuro(after)}</span>
    </span>
  );
}

/** What the change does per child, and in all with several children. */
function PayerEffects({
  preview,
  registration,
}: Readonly<{
  preview: HolidayPayerPreview;
  registration: HolidayRegistrationDetail;
}>) {
  const childName = (childId: string, position: number) => {
    const child =
      registration.children.find((candidate) => candidate.id === childId) ??
      registration.children[position - 1];
    return child ? `${child.firstName} ${child.lastName}` : `Kind ${position}`;
  };
  // The cost bearer's row shows only where one pays before or after.
  const namesCostBearer = preview.children.some(
    (child) =>
      child.costBearerBeforeCents > 0 || child.costBearerAfterCents > 0,
  );
  const sum = (
    pick: (child: HolidayPayerPreview["children"][number]) => number,
  ) => preview.children.reduce((total, child) => total + pick(child), 0);
  const rows = (
    family: readonly [number, number],
    costBearer: readonly [number, number],
  ) => (
    <DataGrid columns={1}>
      <DataField label="Die Familie bezahlt" inline>
        <AmountChange before={family[0]} after={family[1]} />
      </DataField>
      {namesCostBearer ? (
        <DataField label="Der Kostenträger bezahlt" inline>
          <AmountChange before={costBearer[0]} after={costBearer[1]} />
        </DataField>
      ) : null}
    </DataGrid>
  );
  return (
    <div className="space-y-4">
      {preview.children.map((child) => (
        <div key={child.childId} className="space-y-2">
          <p className="text-sm font-semibold text-gray-900">
            {childName(child.childId, child.position)}
          </p>
          {rows(
            [child.familyBeforeCents, child.familyAfterCents],
            [child.costBearerBeforeCents, child.costBearerAfterCents],
          )}
        </div>
      ))}
      {preview.children.length > 1 ? (
        <div className="space-y-2 border-t border-gray-200 pt-3">
          <p className="text-sm font-semibold text-gray-900">Alle Kinder</p>
          {rows(
            [
              sum((child) => child.familyBeforeCents),
              sum((child) => child.familyAfterCents),
            ],
            [
              sum((child) => child.costBearerBeforeCents),
              sum((child) => child.costBearerAfterCents),
            ],
          )}
        </div>
      ) : null}
      {preview.chosen.kind !== "family" &&
      sum((child) => child.familyAfterCents) > 0 ? (
        <p className="text-sm text-gray-700">
          Das Mittagessen bezahlt die Familie weiter selbst. Befreiung und
          Kostenübernahme gelten nur für die Betreuung.
        </p>
      ) : null}
      {preview.chosen.kind === "exemption" ? (
        <p className="text-sm text-gray-700">
          Bei einer Befreiung bezahlt niemand. Du forderst nichts bei einem
          Kostenträger an.
        </p>
      ) : null}
    </div>
  );
}

export function HolidayPayerEditor({
  periodId,
  registration,
  contribution,
  costBearers,
  billingHref = null,
  onSaved,
  onCancel,
}: Readonly<{
  periodId: string;
  registration: HolidayRegistrationDetail;
  /** The frozen contribution the change starts from. */
  contribution: HolidayContribution;
  /** The active cost bearers of the Träger. */
  costBearers: readonly CostBearerChoice[];
  /** Where the invoice of the period stands; null without the right. */
  billingHref?: string | null;
  /** After the save; the page reads the registration again. Never rejects. */
  onSaved: () => Promise<unknown>;
  onCancel: () => void;
}>) {
  const current = holidayPayerOf(contribution);
  const [choice, setChoice] = useState<HolidayPayerChoice>({
    kind: current.kind,
    costBearerId: current.costBearerId,
  });
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const { success } = useToast();

  // A cost bearer the Abrechnung switched off since stays the payer, but is
  // no choice any more: without another payer there is nothing to preview.
  const changed = !sameChoice(choice, current);
  const optionsReader = useFreshTraegerResource(
    traegerKeys.holidayPayerChange(periodId, registration.id, "family"),
    () =>
      fetchHolidayPayerChange(periodId, registration.id, {
        kind: "family",
        costBearerId: null,
      }),
    "die Auswahl der Zahler",
  );
  const chosenKey =
    choice.kind === "cost_bearer" ? (choice.costBearerId ?? "") : choice.kind;
  const previewReader = useFreshTraegerResource(
    changed && choice.kind !== "family"
      ? traegerKeys.holidayPayerChange(periodId, registration.id, chosenKey)
      : null,
    () => fetchHolidayPayerChange(periodId, registration.id, choice),
    "die neuen Beträge",
  );
  // The family's preview doubles as the read of the options.
  const reader = choice.kind === "family" ? optionsReader : previewReader;
  const preview = changed ? reader.data : null;
  const exemptionAvailable =
    (optionsReader.data?.exemptionAvailable ?? false) ||
    current.kind === "exemption";

  const action = useActionOn(
    {
      opening: registration.id,
      data: preview ?? undefined,
      reload: reader.reloadOrThrow,
    },
    { token: (read) => read.fingerprint },
  );
  const form = useReadDraftForm(action, errors, "der Zahler");

  const changePayer = (kind: HolidayPayerKind) => {
    errors.clear();
    setChoice({
      kind,
      costBearerId:
        kind === "cost_bearer"
          ? (costBearers.find((bearer) => bearer.id === current.costBearerId)
              ?.id ??
            costBearers[0]?.id ??
            null)
          : null,
    });
  };

  const submit = async () => {
    if (saving || !preview || !form.begin()) return;
    if (!reason.trim()) {
      errors.invalid("Bitte prüfe deine Angaben.", {
        reason: "Bitte gib eine Begründung ein.",
      });
      return;
    }
    setSaving(true);
    const result = await action.submit(() =>
      changeHolidayPayer(
        periodId,
        registration.id,
        choice,
        reason.trim(),
        preview.fingerprint,
      ),
    );
    if (!result.ok) {
      setSaving(false);
      if (result.skipped) return;
      logger.error("holiday_payer_change_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Inzwischen geändert: `reload` zeigt die neu berechneten Beträge,
      // ohne „Wiederholen“ (ADR 0311).
      void errors.show(
        result.error,
        result.refused
          ? { object: "der Zahler", reload: result.reload }
          : { object: "der Zahler" },
      );
      return;
    }
    success("Der Zahler ist geändert.");
    await onSaved();
    setSaving(false);
  };

  const hasChoice = exemptionAvailable || costBearers.length > 0;
  let disabledReason: string | undefined;
  if (!changed) disabledReason = "Wähle zuerst einen anderen Zahler.";
  else if (!preview) disabledReason = "Die neuen Beträge werden berechnet.";
  else disabledReason = form.waitReason;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <SectionCard
        concept={contributionsConcept}
        title="Zahler ändern"
        description={`Bisher bezahlt: ${holidayPayerText(current)}.`}
        footer={
          <EditActions
            onCancel={() => {
              errors.clear();
              onCancel();
            }}
            saving={saving}
            saveType="submit"
            saveLabel="Änderung speichern"
            saveTooltip="Hält den Beitrag mit dem neuen Zahler fest. Eltern bekommen keine Nachricht."
            disabled={!changed || !preview || !action.canSubmit}
            disabledReason={disabledReason}
          />
        }
      >
        <div className="space-y-5 text-sm text-gray-700">
          <LoadErrorAlert error={optionsReader.error} />
          <LoadErrorAlert
            error={choice.kind === "family" ? null : previewReader.error}
          />
          <LoadErrorAlert error={form.loadError} />
          <FormErrorAlert message={errors.error} />
          {/* Ab `lg` steht die Wirkung neben der Wahl, damit beides ohne
              Scrollen zusammen zu sehen ist; darunter folgt sie der Wahl. */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8">
            <div className="lg:col-start-1">
              {optionsReader.loading ? (
                <p className="flex items-center gap-2" role="status">
                  <SpinnerIcon className="h-4 w-4" aria-hidden="true" />
                  Die Auswahl wird geladen …
                </p>
              ) : optionsReader.data && !hasChoice ? (
                <p>
                  Dein Träger hat keine Befreiungsregel und keinen Kostenträger.
                  Die Rolle „Abrechnung“ legt beides unter „Abrechnungsvorgaben“
                  an. Danach kannst du hier den Zahler ändern.
                </p>
              ) : (
                <HolidayPayerChoiceField
                  idPrefix="holiday-payer-change"
                  payer={choice.kind}
                  exemptionAvailable={exemptionAvailable}
                  costBearers={costBearers}
                  costBearerId={choice.costBearerId}
                  onPayerChange={changePayer}
                  onCostBearerChange={(id) => {
                    errors.clear();
                    setChoice({ kind: "cost_bearer", costBearerId: id });
                  }}
                />
              )}
            </div>
            <div className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <InsetPanel padding="md">
                <SectionLabel as="h3" className="mb-3">
                  Das ändert sich beim Speichern
                </SectionLabel>
                {preview ? (
                  <PayerEffects preview={preview} registration={registration} />
                ) : changed && !reader.error ? (
                  <p className="flex items-center gap-2" role="status">
                    <SpinnerIcon className="h-4 w-4" aria-hidden="true" />
                    moto berechnet die neuen Beträge …
                  </p>
                ) : (
                  <p>
                    Wähle oben einen anderen Zahler. Dann stehen hier die neuen
                    Beträge für jedes Kind.
                  </p>
                )}
              </InsetPanel>
              {preview?.invoiced ? (
                <Alert
                  type="warning"
                  title="Die Rechnung ist schon ausgestellt"
                  message="Sie bleibt, wie sie ist. Storniere sie nach dem Speichern in der Abrechnung. Der nächste Abrechnungslauf stellt dann den neuen Betrag aus."
                  action={
                    billingHref ? (
                      <ButtonLink
                        href={billingHref}
                        variant="surface"
                        size="compact"
                        tooltip="Öffnet die Abrechnung mit der Rechnung dieser Anmeldung."
                      >
                        Zur Abrechnung
                      </ButtonLink>
                    ) : undefined
                  }
                />
              ) : null}
            </div>
            <div className="lg:col-start-1">
              <Textarea
                id="holiday-payer-change-reason"
                name="reason"
                label="Begründung"
                required
                autoGrow
                rows={2}
                maxLength={REASON_MAX_LENGTH}
                value={reason}
                hint="Steht im Verlauf der Anmeldung. Zum Beispiel: „Bescheid nachgereicht“."
                error={errors.fieldError("reason") ?? undefined}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>
        </div>
      </SectionCard>
    </form>
  );
}
