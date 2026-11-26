"use client";

// Status einer Ferienanmeldung und was das Träger-Büro damit tun kann
// (#4663): bestätigen, stornieren, einfrieren und wieder öffnen. Die Karte
// sagt, warum eine Aktion gerade fehlt; die Aktionen stehen im Seitenkopf,
// „Bestätigen“ sichtbar, alles andere in seinem Menü (#7410). Das Bestätigen hält den Ferienbeitrag
// fest, auf Wunsch mit der Befreiung bei Leistungsbezug (#4664) oder mit
// der Kostenübernahme durch einen Kostenträger (#5627). Fragt der
// Träger die Debitorennummer ab, ist sie beim Bestätigen Pflicht (#5621).
// Bei einer bestätigten Anmeldung trägt das Büro die Nummer hier nach oder
// ändert sie, bis die Rechnung ausgestellt ist; danach hält die Rechnung sie
// fest. Hat die Familie beim Träger schon eine Nummer, steht sie als
// Vorschlag am Feld; weicht die eingetragene ab, fragt ein Dialog, welche
// Nummer gilt (#6692).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { JumpButton } from "~/components/ui/jump-button";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import NavigationLink from "~/components/ui/navigation-link";
import { ConfirmationModal } from "~/components/ui/modal";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { enrollmentsConcept } from "~/lib/concepts/enrollments";
import {
  DEBTOR_NUMBER_TEXT_CLASS,
  FamilyDebtorNumberConflictDialog,
  FamilyDebtorNumberHint,
} from "~/components/traeger/family-debtor-number";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import {
  DEBTOR_NUMBER_MAX_LENGTH,
  type DebtorNumberFormat,
  NO_DEBTOR_NUMBER_FORMAT,
  debtorNumberFormatError,
  debtorNumberFormatHint,
} from "~/lib/debtor-number-format";
import {
  useRefreshAfterWrite,
  type RefreshAfterWrite,
} from "~/lib/hooks/use-refresh-after-write";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useActionOn, useDraftOn } from "~/lib/swr/read-draft";
import { holidayRegistrationChildCardId } from "./holiday-registration-child-card";
import { HolidayPayerChoice } from "./holiday-payer-choice";
import { traegerPath } from "~/lib/traeger-url";
import {
  cancelHolidayRegistration,
  changeHolidayDebtorNumber,
  confirmHolidayRegistration,
  familyDebtorNumberConflictOf,
  type FamilyDebtorNumberChoice,
  type FamilyDebtorNumberConflict,
  type HolidayChildDebtorNumber,
  type HolidayContribution,
  type HolidayFamilyDebtorNumbers,
  type HolidayPayerKind,
} from "~/lib/traeger-contributions-api";
import {
  changeHolidayRegistration,
  type CostBearerChoice,
  type HolidayRegistrationAction,
  type HolidayRegistrationDetail,
} from "~/lib/traeger-holiday-registrations-api";
import type { OverflowMenuEntry } from "~/components/ui/page-header/OverflowMenu";
import {
  ChildDebtorNumberInputs,
  ChildDebtorNumbersField,
  type ChildNumberValues,
  childNumberHints,
  childNumberInputs,
  storedChildNumbers,
} from "./holiday-child-debtor-numbers";

const logger = createLogger({ component: "HolidayRegistrationStatusCard" });

function statusText(registration: HolidayRegistrationDetail): string {
  if (registration.status === "cancelled") {
    return "Diese Anmeldung ist storniert. Sie lässt sich nicht mehr ändern.";
  }
  const confirmed =
    registration.status === "confirmed"
      ? "Die Anmeldung ist bestätigt."
      : "Die Anmeldung ist eingegangen und noch nicht bestätigt.";
  const frozen = registration.frozen
    ? " Sie ist eingefroren. Zum Stornieren oder Umbuchen wählst du „Wieder öffnen“."
    : " Nach dem Anmeldeschluss wird sie eingefroren. Zum Stornieren oder Umbuchen wählst du dann „Wieder öffnen“.";
  return confirmed + frozen;
}

/** What the card says about the parents' statement on benefits. */
function benefitsText(
  registration: HolidayRegistrationDetail,
  contribution: HolidayContribution | null,
  canManageBillingSettings: boolean,
): ReactNode {
  if (!registration.benefitsDeclared) return null;
  if (contribution?.exemptionAvailable) {
    return "Die Eltern geben an, dass sie Leistungen beziehen. Bitte prüfe den Nachweis.";
  }
  if (!canManageBillingSettings) {
    return "Die Eltern geben an, dass sie Leistungen beziehen. Am ersten gebuchten Tag gilt keine Befreiungsregel. Die Rolle „Abrechnung“ legt sie an.";
  }
  return (
    <>
      Die Eltern geben an, dass sie Leistungen beziehen. Am ersten gebuchten Tag
      gilt keine Befreiungsregel. Du legst sie unter{" "}
      <NavigationLink
        href={traegerPath("/traeger/einstellungen/abrechnung")}
        className="font-medium underline"
      >
        Abrechnungsvorgaben
      </NavigationLink>{" "}
      an.
    </>
  );
}

/** The hint under the debtor number, at the confirmation and at a change. */
const DEBTOR_NUMBER_HINT =
  "Die Nummer der Familie bei der Kasse der Gemeinde. Die Familie gibt sie bei der Überweisung an.";

/**
 * The field hints of a number the form refuses before it asks the backend:
 * none where the Träger wants one (#5621), another format (#6675).
 */
function debtorNumberHints(
  value: string,
  required: boolean,
  format: DebtorNumberFormat,
): Record<string, string> | null {
  if (required && !value.trim()) {
    return { debtor_number: "Bitte gib die Debitorennummer ein." };
  }
  const formatError = debtorNumberFormatError(value, format);
  return formatError ? { debtor_number: formatError } : null;
}

/** What the card says about the debtor number, before and after the invoice. */
function debtorNumberText(set: boolean, invoiced: boolean): string {
  const missing = set
    ? ""
    : " Ohne Nummer steht im Schreiben die Rechnungsnummer als Verwendungszweck.";
  if (!invoiced) {
    return `Sie steht im Schreiben als Verwendungszweck. Ändern kannst du sie, bis die Rechnung ausgestellt ist.${missing}`;
  }
  return set
    ? "Die Rechnung ist ausgestellt. Die Debitorennummer lässt sich nicht mehr ändern."
    : `Die Rechnung ist ohne Debitorennummer ausgestellt. Eine Nummer lässt sich nicht mehr eintragen.${missing}`;
}

/**
 * The debtor number of a confirmed registration (#5621): shown, and edited in
 * place until the invoice is issued. `editing` belongs to the card, which
 * hides its own button while the field is open.
 */
function DebtorNumberField({
  periodId,
  registrationId,
  debtorNumber,
  familyNumber,
  required,
  format,
  invoiced,
  editing,
  onEditingChange,
  onChanged,
}: Readonly<{
  periodId: string;
  registrationId: string;
  debtorNumber: string;
  /** The number the family has at the Träger (#6692); "" for none. */
  familyNumber: string;
  required: boolean;
  /** The format of the Träger's numbers (#6675). */
  format: DebtorNumberFormat;
  invoiced: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Reloads the registration; never rejects (#6652). */
  onChanged: RefreshAfterWrite;
}>) {
  const [value, setValue] = useState(debtorNumber);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<FamilyDebtorNumberConflict | null>(
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();

  useEffect(() => {
    if (!editing) return;
    setValue(debtorNumber);
    clearErrors();
    fieldRef.current?.focus();
  }, [editing, debtorNumber, clearErrors]);

  const submit = async (choice?: FamilyDebtorNumberChoice) => {
    if (saving) return;
    formErrors.clear();
    const hints = debtorNumberHints(value, required, format);
    if (hints) {
      formErrors.invalid("Bitte prüfe deine Angaben.", hints);
      return;
    }
    setSaving(true);
    try {
      await changeHolidayDebtorNumber(
        periodId,
        registrationId,
        value.trim(),
        choice,
      );
      setConflict(null);
    } catch (err) {
      // A number that differs from the family's needs a choice (#6692).
      const differs = familyDebtorNumberConflictOf(err);
      if (differs) {
        // The request is over: the dialog's choices must work.
        setSaving(false);
        setConflict(differs);
        return;
      }
      setConflict(null);
      logger.error("holiday_debtor_number_change_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void formErrors.show(err, { object: "die Debitorennummer" });
      setSaving(false);
      return;
    }
    setSaving(false);
    success("Die Debitorennummer ist gespeichert.");
    onEditingChange(false);
    await onChanged();
  };

  if (editing && !invoiced) {
    return (
      <form
        ref={formRef}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormErrorAlert message={formErrors.error} />
        <div className="sm:max-w-xl">
          <Input
            ref={fieldRef}
            id="holiday-debtor-number"
            required={required}
            name="debtor_number"
            label="Debitorennummer"
            autoComplete="off"
            controlSize="compact"
            inputMode={format.digitsOnly ? "numeric" : undefined}
            maxLength={DEBTOR_NUMBER_MAX_LENGTH}
            value={value}
            hint={`${debtorNumberFormatHint(format)} ${DEBTOR_NUMBER_HINT}`.trim()}
            aria-describedby={
              familyNumber && value.trim() !== familyNumber
                ? "holiday-debtor-number-family"
                : undefined
            }
            error={formErrors.fieldError("debtor_number") ?? undefined}
            onChange={(event) => setValue(event.target.value)}
          />
          <FamilyDebtorNumberHint
            id="holiday-debtor-number-family"
            familyNumber={familyNumber}
            value={value}
            onAdopt={(number) => {
              setValue(number);
              fieldRef.current?.focus();
            }}
          />
        </div>
        <EditActions
          onCancel={() => onEditingChange(false)}
          saving={saving}
          saveType="submit"
        />
        <FamilyDebtorNumberConflictDialog
          conflict={conflict}
          running={saving}
          onChoose={(choice) => void submit(choice)}
          onClose={() => setConflict(null)}
        />
      </form>
    );
  }

  return (
    <div className="space-y-2">
      <DataGrid columns={2}>
        <DataField label="Debitorennummer">
          {debtorNumber ? (
            <span className={`wrap-anywhere ${DEBTOR_NUMBER_TEXT_CLASS}`}>
              {debtorNumber}
            </span>
          ) : (
            "Noch keine Nummer."
          )}
        </DataField>
      </DataGrid>
      <p>{debtorNumberText(Boolean(debtorNumber), invoiced)}</p>
    </div>
  );
}

type Payer = HolidayPayerKind;

const NO_COST_BEARERS: readonly CostBearerChoice[] = [];

const NO_CHILD_NUMBERS: readonly HolidayChildDebtorNumber[] = [];

/** The confirmation was not ready to send (a second click): nothing to show. */
const CONFIRM_SKIPPED = new Error("holiday confirmation was not ready");

/** The props of the status, as the page passes them. */
export interface HolidayRegistrationStatusProps {
  readonly periodId: string;
  readonly registration: HolidayRegistrationDetail;
  /** The contribution a confirmation freezes; null while it loads. */
  readonly contribution: HolidayContribution | null;
  /** The preview is computed again; the confirmation waits for it. */
  readonly previewPending?: boolean;
  /** The Träger asks for the debtor number at the confirmation (#5621). */
  readonly debtorNumberRequired?: boolean;
  /** The format of the Träger's debtor numbers (#6675). */
  readonly debtorNumberFormat?: DebtorNumberFormat;
  /**
   * The number the family already has at the Träger (#6692), proposed at the
   * field; "" for none.
   */
  readonly familyDebtorNumber?: string;
  /**
   * The children of the registration with their numbers when the Träger
   * keeps the number per child (#7007); empty with a number per payer.
   * Several children get a field each, as each gets an invoice of its own.
   */
  readonly childDebtorNumbers?: readonly HolidayChildDebtorNumber[];
  /**
   * The version of those numbers (ADR 0311): a confirmation that sends them
   * and a change of them send it back.
   */
  readonly childNumbersVersion?: string;
  /** The exemption the confirmation applies; the page shows its preview. */
  readonly exemption: boolean;
  readonly onExemptionChange: (exemption: boolean) => void;
  /** The active cost bearers the confirmation offers (#5627). */
  readonly costBearers?: readonly CostBearerChoice[];
  /** The cost bearer that pays; null while the family pays or is exempt. */
  readonly costBearerId?: string | null;
  readonly onCostBearerChange?: (costBearerId: string | null) => void;
  readonly onChanged: (registration: HolidayRegistrationDetail) => void;
  /**
   * After a confirmation or a cancellation; the page reads the registration
   * and its contribution again. A cancellation can change the sibling group
   * (#5662). Rejects when the read fails.
   */
  readonly onReload: () => Promise<unknown>;
  /** After a change of the debtor number; the page reads it again. */
  readonly onDebtorNumberChanged: () => Promise<unknown>;
  /**
   * Reads the registration with its contribution and numbers after a
   * refusal of a changed state (ADR 0311) and resolves with the numbers
   * read (undefined: they arrive through the props); rejects when the read
   * fails.
   */
  readonly onRead: () => Promise<HolidayFamilyDebtorNumbers | undefined>;
  /** Hands the children's numbers a save answered to the page's read. */
  readonly onFamilyNumbersSaved: (
    stored: HolidayFamilyDebtorNumbers,
  ) => Promise<unknown>;
  /** Das Recht „Abrechnung“ öffnet die Beitragsregeln. */
  readonly canManageBillingSettings?: boolean;
  /** Where the invoice of the period stands; null without the right. */
  readonly billingHref?: string | null;
  /**
   * Brings the status card into view, for the page with tabs: „Bestätigen“
   * and the debtor number entries of the page menu work on the card (#7410).
   */
  readonly onReveal?: () => void;
  /**
   * Whether the card is on the screen. From another tab „Bestätigen“ only
   * brings it into view: payer and debtor number stand there, and the
   * confirmation mails the parents at once.
   */
  readonly cardShown?: boolean;
  /** Brings the children into view; the duplicate notice leads there. */
  readonly onRevealChildren?: () => void;
}

/** The status of a registration, split for the page that shows it (#7410). */
export interface HolidayRegistrationStatus {
  /** „Bestätigen“ for the page head; null when the status does not allow it. */
  readonly confirmAction: ReactNode;
  /** The other actions of the status, for the menu of the page head. */
  readonly menuItems: readonly OverflowMenuEntry[];
  /** „Stornieren“, last in that menu; empty when the status forbids it. */
  readonly cancelItems: readonly OverflowMenuEntry[];
  /** The card: the status, its notices and the fields of the confirmation. */
  readonly card: ReactNode;
  /** The dialogs of the actions; they stay mounted on every tab. */
  readonly overlays: ReactNode;
}

const NO_REVEAL = () => {};

/**
 * Status einer Ferienanmeldung und ihre Aktionen (#4663). „Bestätigen“ ist
 * die einzige sichtbare Aktion im Seitenkopf, alles andere steht in dessen
 * Menü; die Karte zeigt nur den Status (#7410).
 */
function useHolidayRegistrationStatus({
  periodId,
  registration,
  contribution,
  previewPending = false,
  debtorNumberRequired = false,
  debtorNumberFormat = NO_DEBTOR_NUMBER_FORMAT,
  familyDebtorNumber = "",
  childDebtorNumbers = NO_CHILD_NUMBERS,
  childNumbersVersion = "",
  exemption,
  onExemptionChange,
  costBearers = NO_COST_BEARERS,
  costBearerId = null,
  onCostBearerChange,
  onChanged,
  onReload,
  onDebtorNumberChanged,
  onRead,
  onFamilyNumbersSaved,
  canManageBillingSettings = false,
  billingHref = null,
  onReveal = NO_REVEAL,
  cardShown = true,
  onRevealChildren,
}: HolidayRegistrationStatusProps): HolidayRegistrationStatus {
  const [running, setRunning] = useState<
    HolidayRegistrationAction | "confirm" | "cancel" | null
  >(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // A sibling group pays with one number (#5628): its current number is the
  // proposal. It follows the registration and its group, for example after
  // a split, until the Träger-Büro types its own number for this
  // registration; that one stays.
  const [typedDebtorNumber, setTypedDebtorNumber] = useState<{
    readonly registrationId: string;
    readonly value: string;
  } | null>(null);
  const enteredDebtorNumber =
    typedDebtorNumber?.registrationId === registration.id
      ? typedDebtorNumber.value
      : null;
  const debtorNumber =
    enteredDebtorNumber ?? contribution?.siblingDebtorNumber ?? "";
  const setDebtorNumber = (value: string) =>
    setTypedDebtorNumber({ registrationId: registration.id, value });
  const [editingDebtorNumber, setEditingDebtorNumber] = useState(false);
  const [editingChildNumbers, setEditingChildNumbers] = useState(false);
  // With a number per child, several children get a field each (#7007).
  const perChild = childDebtorNumbers.length > 1;
  // A cancelled whole-registration invoice keeps its shape after a scope
  // switch. Its existing number must remain editable for the replacement.
  const showsRegistrationNumber = !perChild || registration.debtorNumber !== "";
  const familyNumbers = useMemo<HolidayFamilyDebtorNumbers>(
    () => ({
      debtorNumber: familyDebtorNumber,
      children: childDebtorNumbers,
      version: childNumbersVersion,
    }),
    [familyDebtorNumber, childDebtorNumbers, childNumbersVersion],
  );
  const childHasNumber = childDebtorNumbers.some((child) => child.debtorNumber);
  const [conflict, setConflict] = useState<FamilyDebtorNumberConflict | null>(
    null,
  );
  const confirmFieldRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLFormElement>(null);
  const confirmErrors = useApiFormError(confirmRef);
  // One read per refusal: the confirmation's refusal reads the stored state,
  // and the children's numbers settle on that same read (ADR 0311).
  const lastRead = useRef<Promise<
    HolidayFamilyDebtorNumbers | undefined
  > | null>(null);
  const refusalRead = useRef<Promise<
    HolidayFamilyDebtorNumbers | undefined
  > | null>(null);
  const readStored = useCallback(() => {
    const read = onRead();
    lastRead.current = read;
    return read;
  }, [onRead]);
  // The confirmation freezes the preview on screen and sends its
  // fingerprint (ADR 0311); after a refusal nothing is sent until the
  // stored state is read.
  const confirmRead = useActionOn(
    {
      opening: registration.status === "received" ? registration.id : null,
      data: contribution ?? undefined,
      reload: readStored,
    },
    { token: (read) => read.fingerprint ?? "" },
  );
  const errorDisplay = useApiErrorDisplay();
  // A write's reload stands above the card as a load error, never as an
  // error of the confirmation, the cancellation or the debtor number (#6652).
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige der Anmeldung",
    onReload,
  );
  const debtorAfterWrite = useRefreshAfterWrite(
    "die Anzeige der Anmeldung",
    onDebtorNumberChanged,
  );
  const exemptionAvailable = contribution?.exemptionAvailable ?? false;
  const invoiced = contribution?.invoiced ?? false;
  let payer: Payer = "family";
  if (
    costBearerId &&
    costBearers.some((bearer) => bearer.id === costBearerId)
  ) {
    payer = "cost_bearer";
  } else if (exemptionAvailable && exemption) {
    payer = "exemption";
  }
  const showsDebtorNumber =
    registration.status === "confirmed" &&
    (debtorNumberRequired ||
      (perChild
        ? childHasNumber
        : Boolean(registration.debtorNumber) || Boolean(familyDebtorNumber)));
  // The confirmation asks for the number when the Träger wants it, and
  // offers it when the family already has one (#6692).
  const asksDebtorNumber =
    debtorNumberRequired ||
    (perChild ? childHasNumber : Boolean(familyDebtorNumber));
  // The children's fields rest on the numbers read when the card opened and
  // send their version (ADR 0311): a newer read refills them only while
  // nothing is typed.
  const sendsChildNumbers =
    registration.status === "received" && perChild && asksDebtorNumber;
  const childDraft = useDraftOn<
    HolidayFamilyDebtorNumbers,
    ChildNumberValues,
    string
  >(
    {
      opening: sendsChildNumbers ? registration.id : null,
      data: familyNumbers,
      reload: () => {
        const shared = refusalRead.current;
        refusalRead.current = null;
        return shared ?? onRead();
      },
    },
    {
      token: (read) => read.version,
      toDraft: (read) => storedChildNumbers(read.children),
      // A refusal of the preview alone leaves the numbers as read: the
      // typed ones stay; newer numbers replace them.
      rebase: (draft, from, to) =>
        from.version === to.version ? draft : storedChildNumbers(to.children),
      // A confirmed registration closes the fields; the page reads it
      // again after the confirmation (afterWrite).
      answer: (_saved, base) => base,
    },
  );
  const childBase = childDraft.base ?? familyNumbers;
  const childNumbers =
    childDraft.draft ?? storedChildNumbers(childDebtorNumbers);
  // Enter in the debtor number submits the form, so the guards of the button
  // hold here too: one confirmation at a time, and only of the amount shown.
  const confirmBlocked =
    running !== null ||
    contribution === null ||
    previewPending ||
    !confirmRead.canSubmit ||
    (sendsChildNumbers && !childDraft.canSubmit);
  // Either read waits after a refusal: its failure shows over the form.
  const confirmForm = useReadDraftForm(
    sendsChildNumbers && !childDraft.canSubmit ? childDraft : confirmRead,
    confirmErrors,
    "die Anmeldung",
  );

  const confirm = async (choice?: FamilyDebtorNumberChoice) => {
    if (running !== null || contribution === null || previewPending) return;
    // Nothing goes out before the stored state is read; the shown error
    // stays then.
    if (!confirmForm.begin() || (sendsChildNumbers && !childDraft.canSubmit))
      return;
    const hints = perChild
      ? childNumberHints(
          childBase.children,
          childNumbers,
          debtorNumberRequired,
          debtorNumberFormat,
        )
      : debtorNumberHints(
          debtorNumber,
          debtorNumberRequired,
          enteredDebtorNumber === null
            ? NO_DEBTOR_NUMBER_FORMAT
            : debtorNumberFormat,
        );
    if (hints) {
      confirmErrors.invalid("Bitte prüfe deine Angaben.", hints);
      return;
    }
    setRunning("confirm");
    const send = (childNumbersVersion?: string, values?: ChildNumberValues) =>
      confirmHolidayRegistration(
        periodId,
        registration.id,
        { fingerprint: contribution.fingerprint ?? "", childNumbersVersion },
        payer === "exemption",
        // An untouched sibling number is inherited under the backend's locks.
        perChild ? "" : (enteredDebtorNumber?.trim() ?? ""),
        payer === "cost_bearer" ? (costBearerId ?? undefined) : undefined,
        choice,
        values ? childNumberInputs(childBase.children, values) : undefined,
      );
    // The numbers' draft wraps the confirmation. A refusal reads the stored
    // state once: the confirmation's read, on which the numbers settle too.
    const result = sendsChildNumbers
      ? await childDraft.submit(async (version, values) => {
          refusalRead.current = null;
          const sent = await confirmRead.submit(() => send(version, values));
          if (sent.ok) return sent.saved;
          if (sent.skipped) throw CONFIRM_SKIPPED;
          if (sent.refused) refusalRead.current = lastRead.current;
          throw sent.error;
        })
      : await confirmRead.submit(() => send());
    if (!result.ok) {
      setRunning(null);
      if (result.skipped || result.error === CONFIRM_SKIPPED) return;
      // A number that differs from the family's needs a choice (#6692).
      const differs = familyDebtorNumberConflictOf(result.error);
      if (differs) {
        setConflict(differs);
        return;
      }
      setConflict(null);
      logger.error("holiday_registration_confirm_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Inzwischen geändert: `reload` zeigt den gespeicherten Stand, ohne
      // „Wiederholen“ (ADR 0311).
      void confirmErrors.show(
        result.error,
        result.refused
          ? { object: "die Anmeldung", reload: result.reload }
          : { object: "die Anmeldung" },
      );
      return;
    }
    setConflict(null);
    await afterWrite.refresh();
    setRunning(null);
  };

  const run = async (action: HolidayRegistrationAction | "cancel") => {
    setRunning(action);
    try {
      if (action === "cancel") {
        // The Elternabrechnung cancels and computes the siblings again
        // (#5662); the page reads both again.
        await cancelHolidayRegistration(periodId, registration.id);
      } else {
        onChanged(
          await changeHolidayRegistration(periodId, registration.id, action),
        );
      }
    } catch (err) {
      logger.error("holiday_registration_change_failed", {
        action,
        error: err instanceof Error ? err.message : String(err),
      });
      void errorDisplay.show(err, { object: "die Anmeldung" });
      setRunning(null);
      setConfirmingCancel(false);
      return;
    }
    setRunning(null);
    setConfirmingCancel(false);
    if (action === "cancel") await afterWrite.refresh();
  };

  const open = registration.status !== "cancelled";
  const duplicateChildren = registration.children.filter(
    (child) => child.duplicateRegistrationIds.length > 0,
  );
  const firstDuplicate = duplicateChildren[0];
  const duplicateNames = duplicateChildren.map((child) =>
    `${child.firstName} ${child.lastName}`.trim(),
  );
  const duplicateIds = [
    ...new Set(
      duplicateChildren.flatMap((child) => child.duplicateRegistrationIds),
    ),
  ];
  const choosesPayer =
    registration.status === "received" &&
    (exemptionAvailable || costBearers.length > 0);
  const changePayer = (next: Payer) => {
    if (next === "cost_bearer") {
      onCostBearerChange?.(costBearerId ?? costBearers[0]?.id ?? null);
      return;
    }
    onCostBearerChange?.(null);
    onExemptionChange(next === "exemption");
  };
  const busy = running !== null;
  const menuItems: OverflowMenuEntry[] = [];
  if (open && registration.frozen) {
    menuItems.push({
      label: running === "reopen" ? "Öffnet …" : "Wieder öffnen",
      description:
        "Öffnet die Anmeldung wieder, damit du stornieren oder umbuchen kannst.",
      disabled: busy,
      onClick: () => void run("reopen"),
    });
  } else if (open) {
    menuItems.push({
      label: running === "freeze" ? "Friert ein …" : "Einfrieren",
      description: "Sperrt die Anmeldung sofort gegen Stornieren und Umbuchen.",
      disabled: busy,
      onClick: () => void run("freeze"),
    });
  }
  if (
    open &&
    showsDebtorNumber &&
    perChild &&
    !editingChildNumbers &&
    !editingDebtorNumber
  ) {
    menuItems.push({
      label: childHasNumber
        ? "Nummern der Kinder bearbeiten"
        : "Nummern der Kinder eintragen",
      description: "Öffnet pro Kind ein Feld für seine Debitorennummer.",
      disabled: busy,
      onClick: () => {
        onReveal();
        setEditingChildNumbers(true);
      },
    });
  }
  if (
    open &&
    showsDebtorNumber &&
    showsRegistrationNumber &&
    !invoiced &&
    !editingDebtorNumber &&
    !editingChildNumbers
  ) {
    menuItems.push({
      label: registration.debtorNumber
        ? "Debitorennummer bearbeiten"
        : "Debitorennummer eintragen",
      description: "Öffnet das Feld für die Debitorennummer dieser Anmeldung.",
      disabled: busy,
      onClick: () => {
        onReveal();
        setEditingDebtorNumber(true);
      },
    });
  }
  const cancelItems: OverflowMenuEntry[] =
    open && !registration.frozen
      ? [
          {
            label: "Stornieren",
            description:
              "Storniert die Anmeldung, Nachrückende bekommen eine E-Mail. moto fragt vorher nach.",
            destructive: true,
            disabled: busy,
            onClick: () => setConfirmingCancel(true),
          },
        ]
      : [];

  // The only visible action of the page head (#7410). From another tab the
  // first click shows the card with payer and debtor number; it confirms
  // only where the person sees what the confirmation freezes.
  const confirmAction =
    registration.status === "received" ? (
      <Button
        type="button"
        variant="primary"
        size="md"
        isLoading={running === "confirm"}
        loadingText="Bestätigt …"
        disabled={cardShown && confirmBlocked}
        disabledReason={cardShown ? confirmForm.waitReason : undefined}
        tooltip={
          cardShown
            ? "Bestätigt die Anmeldung und schickt den Eltern sofort die Zusage per E-Mail."
            : "Zeigt die Übersicht mit Beitrag und Debitorennummer zum Bestätigen."
        }
        onClick={() => {
          if (!cardShown) {
            onReveal();
            return;
          }
          void confirm();
        }}
      >
        Bestätigen
      </Button>
    ) : null;

  const card = (
    <SectionCard concept={enrollmentsConcept} title="Status">
      <div className="space-y-4 text-sm text-gray-700">
        <LoadErrorAlert error={afterWrite.error} />
        <LoadErrorAlert error={debtorAfterWrite.error} />
        <p>{statusText(registration)}</p>
        {/* The children's cards sit far below on a phone: the status names a
            possible double registration first, in one line; the child's card
            holds the way to the other registration. */}
        {duplicateIds.length > 0 ? (
          <Alert
            type="warning"
            message={`Vielleicht doppelt angemeldet: ${duplicateNames.join(", ")}. Die andere Anmeldung öffnest du beim Kind.`}
            action={
              // The child cards render in every state, frozen and cancelled
              // too, so the way to them is always there (#7054).
              firstDuplicate ? (
                <JumpButton
                  targetId={holidayRegistrationChildCardId(firstDuplicate.id)}
                  reveal={onRevealChildren}
                  tooltip="Springt zum Kind mit dem Link zur anderen Anmeldung."
                >
                  Zum Kind
                </JumpButton>
              ) : undefined
            }
          />
        ) : null}
        {registration.status === "received" ? (
          <p>
            Beim Bestätigen bekommen die Eltern eine E-Mail mit den gebuchten
            Wochen und dem{" "}
            <NavigationLink
              href={traegerPath(`/traeger/ferien/${periodId}`)}
              className="font-medium underline"
            >
              Text der Annahme-Mail
            </NavigationLink>
            .
          </p>
        ) : null}
        {registration.status === "received" &&
        registration.children.some((child) =>
          child.bookings.some((booking) => booking.placement === "pending"),
        ) ? (
          <Alert
            type="warning"
            message="Für ein Kind ist noch ein Platz offen. Bestätigen geht erst, wenn das Büro im Reiter Vergabe entschieden hat."
            action={
              <ButtonLink
                href={traegerPath(`/traeger/ferien/${periodId}/vergabe`)}
                variant="surface"
                size="compact"
                tooltip="Öffnet die Vergabe der Plätze in diesem Ferienzeitraum."
              >
                Zur Vergabe
              </ButtonLink>
            }
          />
        ) : null}
        {registration.status === "received" &&
        benefitsText(registration, contribution, canManageBillingSettings) ? (
          <p>
            {benefitsText(registration, contribution, canManageBillingSettings)}
          </p>
        ) : null}
        {registration.status === "received" ? (
          <form
            ref={confirmRef}
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <LoadErrorAlert error={confirmForm.loadError} />
            <FormErrorAlert message={confirmErrors.error} />
            {asksDebtorNumber && perChild ? (
              <ChildDebtorNumberInputs
                idPrefix="holiday-registration-child-debtor-number"
                childNumbers={childBase.children}
                values={childNumbers}
                required={debtorNumberRequired}
                format={debtorNumberFormat}
                fieldError={confirmErrors.fieldError}
                onChange={(childId, value) =>
                  childDraft.setDraft((current) => ({
                    ...current,
                    [childId]: value,
                  }))
                }
              />
            ) : null}
            {asksDebtorNumber && !perChild ? (
              <div className="sm:max-w-xl">
                <Input
                  ref={confirmFieldRef}
                  id="holiday-registration-debtor-number"
                  required={debtorNumberRequired}
                  name="debtor_number"
                  label="Debitorennummer"
                  autoComplete="off"
                  controlSize="compact"
                  inputMode={
                    debtorNumberFormat.digitsOnly ? "numeric" : undefined
                  }
                  maxLength={DEBTOR_NUMBER_MAX_LENGTH}
                  value={debtorNumber}
                  hint={`${debtorNumberFormatHint(debtorNumberFormat)} ${DEBTOR_NUMBER_HINT}`.trim()}
                  aria-describedby={
                    familyDebtorNumber &&
                    debtorNumber.trim() !== familyDebtorNumber
                      ? "holiday-registration-debtor-number-family"
                      : undefined
                  }
                  error={confirmErrors.fieldError("debtor_number") ?? undefined}
                  onChange={(event) => setDebtorNumber(event.target.value)}
                />
                <FamilyDebtorNumberHint
                  id="holiday-registration-debtor-number-family"
                  familyNumber={familyDebtorNumber}
                  value={debtorNumber}
                  onAdopt={(number) => {
                    setDebtorNumber(number);
                    confirmFieldRef.current?.focus();
                  }}
                />
              </div>
            ) : null}
          </form>
        ) : null}
        {invoiced && billingHref ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p>Die Rechnung dieser Anmeldung steht in der Abrechnung.</p>
            <ButtonLink
              href={billingHref}
              variant="outline"
              size="compact"
              tooltip="Öffnet die Abrechnung mit der Rechnung dieser Anmeldung."
            >
              Zur Abrechnung
            </ButtonLink>
          </div>
        ) : null}
        {showsDebtorNumber && perChild ? (
          <ChildDebtorNumbersField
            periodId={periodId}
            registrationId={registration.id}
            numbers={familyNumbers}
            onRead={onRead}
            onSaved={onFamilyNumbersSaved}
            required={debtorNumberRequired}
            format={debtorNumberFormat}
            invoiced={invoiced}
            editing={editingChildNumbers}
            onEditingChange={setEditingChildNumbers}
            onChanged={debtorAfterWrite.refresh}
          />
        ) : null}
        {showsDebtorNumber && showsRegistrationNumber ? (
          <DebtorNumberField
            periodId={periodId}
            registrationId={registration.id}
            debtorNumber={registration.debtorNumber}
            familyNumber={familyDebtorNumber}
            required={debtorNumberRequired}
            format={debtorNumberFormat}
            invoiced={invoiced}
            editing={editingDebtorNumber}
            onEditingChange={setEditingDebtorNumber}
            onChanged={debtorAfterWrite.refresh}
          />
        ) : null}
        {showsDebtorNumber && perChild && showsRegistrationNumber ? (
          <p>
            Die Nummer der Anmeldung gilt für eine gemeinsame Rechnung.
            Rechnungen pro Kind nennen die Nummer des Kindes.
          </p>
        ) : null}
        {choosesPayer ? (
          <HolidayPayerChoice
            payer={payer}
            exemptionAvailable={exemptionAvailable}
            costBearers={costBearers}
            costBearerId={costBearerId}
            onPayerChange={changePayer}
            onCostBearerChange={(id) => onCostBearerChange?.(id)}
          />
        ) : null}
      </div>
    </SectionCard>
  );

  const overlays = (
    <>
      <FamilyDebtorNumberConflictDialog
        conflict={conflict}
        running={running === "confirm"}
        onChoose={(choice) => void confirm(choice)}
        onClose={() => setConflict(null)}
      />
      <ConfirmationModal
        isOpen={confirmingCancel}
        title="Anmeldung stornieren?"
        confirmText="Anmeldung stornieren"
        confirmVariant="danger"
        isConfirmLoading={running === "cancel"}
        loadingText="Storniert …"
        onClose={() => setConfirmingCancel(false)}
        onConfirm={() => void run("cancel")}
      >
        {/* Names what is cancelled, so the decision does not rely on the
            blurred page behind the dialog. */}
        <p className="text-sm font-medium text-gray-900">
          Anmeldung Nr. {registration.id} von{" "}
          {`${registration.guardianFirstName} ${registration.guardianLastName}`.trim()}
          {registration.children.length > 0
            ? `: ${registration.children
                .map((child) => `${child.firstName} ${child.lastName}`.trim())
                .join(", ")}`
            : ""}
        </p>
        {/* One consequence per line, so the irreversible step reads at a
            glance; the way to the invoice stays on the page. */}
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>
            Die Kinder sind dann für keine Woche mehr angemeldet. Das lässt sich
            nicht rückgängig machen.
          </li>
          <li>Eltern bekommen keine Nachricht von moto.</li>
          {contribution?.siblings?.length ? (
            <li>
              Die Anmeldung zählt dann nicht mehr zu den Geschwistern. moto
              berechnet den Ferienbeitrag der Geschwister neu.
            </li>
          ) : null}
          {contribution?.siblings?.length && contribution.siblingsInvoiced ? (
            <li>
              Die schon ausgestellte Rechnung der Geschwister bleibt, wie sie
              ist. Den neuen Betrag zeigt dann ihre Anmeldung unter „Rechnung
              prüfen“.
            </li>
          ) : null}
          {invoiced ? (
            <li>
              Die Rechnung dieser Anmeldung bleibt bestehen. Soll die Familie
              nicht zahlen, storniere sie danach in der Abrechnung.
            </li>
          ) : null}
        </ul>
      </ConfirmationModal>
    </>
  );

  return { confirmAction, menuItems, cancelItems, card, overlays };
}

/**
 * Calls {@link useHolidayRegistrationStatus} where the registration is
 * there: the page reads it first and builds its head from the result.
 */
export function HolidayRegistrationStatusScope({
  children,
  ...props
}: HolidayRegistrationStatusProps & {
  readonly children: (status: HolidayRegistrationStatus) => ReactNode;
}) {
  return children(useHolidayRegistrationStatus(props));
}
