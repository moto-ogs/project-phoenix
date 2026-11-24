"use client";

// Eine Ferienanmeldung prüfen (#4663): alles, was die Eltern angegeben
// haben, mit Status, Ferienbeitrag (#4664), Umbuchen und Verlauf. Die
// Gesundheitsangaben lädt die Seite getrennt und nur mit dem Recht
// „Gesundheitsangaben sehen“ (#4722). Jedes Öffnen steht im Protokoll. Die
// Karten der Angaben wechseln mit „Ändern“ an Ort und Stelle in den
// Bearbeiten-Zustand (#5629); dessen Formulare lädt die Seite erst dann.
// Geschwister aus anderen Anmeldungen stehen mit „Trennen“ in einer eigenen
// Karte (#5628); zusammengeführt wird in der Liste. Vier Reiter ordnen die
// Karten, der Reiter steht in der Adresse; „Bestätigen“ ist die einzige
// sichtbare Kopfaktion, alles andere steht im Menü des Kopfes (#7410).

import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HolidayContributionCard } from "~/components/traeger/holiday-contribution-card";
import {
  answeredQuestions,
  HolidayRegistrationAnswers,
} from "~/components/traeger/holiday-registration-answers";
import { HolidayRegistrationChildCard } from "~/components/traeger/holiday-registration-child-card";
import { HolidayRegistrationCriteriaCard } from "~/components/traeger/holiday-registration-criteria-card";
import {
  CANCELLED_EDIT_TEXT,
  editableQuestions,
} from "~/components/traeger/holiday-registration-edit-fields";
import {
  HolidayDeclarationFields,
  HolidayDeclarationTextsCard,
} from "~/components/traeger/holiday-registration-declaration";
import {
  HOLIDAY_REGISTRATION_STATUS_LABELS,
  HOLIDAY_REGISTRATION_STATUS_TONES,
  schoolNames,
} from "~/components/traeger/holiday-registration-format";
import { Alert } from "~/components/ui/alert";
import { useHolidayRegistrationPdf } from "~/components/traeger/use-holiday-registration-pdf";
import { holidayRegistrationDeletionNotice } from "~/components/traeger/holiday-registration-retention";
import { HolidayRegistrationHistory } from "~/components/traeger/holiday-registration-history";
import { HolidayRegistrationProofCard } from "~/components/traeger/holiday-registration-proof-card";
import { HolidayRegistrationStatusScope } from "~/components/traeger/holiday-registration-status-card";
import {
  HOLIDAY_MAIL_LABELS,
  HolidayRegistrationMailProblemsAlert,
} from "~/components/traeger/holiday-registration-mail-problems";
import { RequestMailStatus } from "~/components/enrollment/request-mail-status";
import { useHolidayPeriodBillingHref } from "~/components/traeger/use-holiday-period-billing-href";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { useRefusalGuard } from "~/components/traeger/use-traeger-confirmed-resource";
import { useSWRRequestGuard } from "~/lib/swr/hooks";
import { ApiError } from "~/lib/api-error";
import {
  useFreshTraegerResource,
  useTraegerResource,
} from "~/components/traeger/use-traeger-resource";
import { metadataLoadError } from "~/components/traeger/metadata-load-error";
import { DataField, DataGrid } from "~/components/ui/data-field";
import {
  DocumentAttachmentList,
  type AttachmentLabels,
} from "~/components/enrollment/attachment-list";
import { fetchHolidayDocument } from "~/lib/traeger-holiday-form-api";
import { LegalMarkdown } from "~/components/enrollment/legal-markdown";
import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { exportMenuItems } from "~/components/ui/export-menu";
import { ConfirmationModal } from "~/components/ui/modal";
import { HolidayConsentWithdrawButton } from "~/components/traeger/holiday-consent-withdraw-button";
import NavigationLink from "~/components/ui/navigation-link";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  TenantPage,
  TenantPageStats,
  type TenantPageTab,
} from "~/components/ui/tenant-page";
import {
  useApiErrorDisplay,
  useApiLoadError,
  useToast,
} from "~/contexts/ToastContext";
import { hasPermission } from "~/lib/auth-utils";
import { parentsConcept } from "~/lib/concepts/parents";
import { formatBerlinDate, formatChatDateTime } from "~/lib/date-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { useTraegerHolidayPeriod } from "~/components/traeger/use-traeger-resources";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchHolidayContribution,
  fetchHolidayFamilyDebtorNumber,
  type HolidayFamilyDebtorNumbers,
  type HolidayContribution,
} from "~/lib/traeger-contributions-api";
import {
  fetchHolidayConfirmationSettings,
  fetchHolidayRegistration,
  fetchHolidayRegistrationHealth,
  type HolidayRegistrationContact,
  type HolidayRegistrationDetail,
  TRAEGER_HEALTH_RIGHT,
  withHolidayHealthAnswers,
} from "~/lib/traeger-holiday-registrations-api";
import { splitHolidaySibling } from "~/lib/traeger-sibling-groups-api";
import {
  knownChildrenKey,
  useHolidayKnownChildren,
} from "~/components/traeger/holiday-known-child";
import { traegerPath } from "~/lib/traeger-url";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { holidayWeeksConcept } from "~/lib/concepts/holidayWeeks";

const PDF_LABELS: AttachmentLabels = {
  open: "Öffnen",
  download: "Herunterladen",
  openLabel: (label) => `${label} öffnen`,
  downloadLabel: (label) => `${label} herunterladen`,
  openHint: "Öffnet die PDF in einem neuen Tab.",
  downloadHint: "Speichert die PDF auf diesem Gerät.",
  popupBlocked:
    "Das PDF konnte nicht geöffnet werden. Bitte erlaube neue Fenster.",
  errorObject: "die PDF-Datei",
};

const NO_FAMILY_DEBTOR_NUMBERS: HolidayFamilyDebtorNumbers = {
  debtorNumber: "",
  children: [],
  version: "",
};

const logger = createLogger({ component: "TraegerHolidayRegistrationPage" });

/** Was die Seite ist und was man dort zuerst tut (#7595). */
const REGISTRATION_INFO =
  "Hier prüfst du eine Anmeldung für die Ferien. Schau dir zuerst die Reiter „Kind“, „Eltern“ und „Nachweise und Beitrag“ an. Ist sie eingegangen, bestätigst du sie oben mit „Bestätigen“.";

const TRAEGER_BILLING_RIGHT = "traeger_billing:manage";
// The mail notice leads here: phone and address of the parents (#6999).
const PARENTS_SECTION_ID = "eltern";

// The tabs of the registration (#7410); the first one has no `tab` in the URL.
const REGISTRATION_TABS = [
  { value: "uebersicht", label: "Übersicht" },
  { value: "kind", label: "Kind" },
  { value: "eltern", label: "Eltern" },
  { value: "nachweise", label: "Nachweise und Beitrag" },
] as const satisfies readonly TenantPageTab[];
type RegistrationTab = (typeof REGISTRATION_TABS)[number]["value"];

function registrationTab(value: string | null | undefined): RegistrationTab {
  return (
    REGISTRATION_TABS.find((tab) => tab.value === value)?.value ?? "uebersicht"
  );
}

// The edit states load with the first „Bearbeiten“, not with the page.
const editors = () => import("~/components/traeger/holiday-registration-edit");
const GuardiansEditor = dynamic(() =>
  editors().then((module) => module.GuardiansEditor),
);
const ChildEditor = dynamic(() =>
  editors().then((module) => module.ChildEditor),
);
const ContactsEditor = dynamic(() =>
  editors().then((module) => module.ContactsEditor),
);
const FamilyAnswersEditor = dynamic(() =>
  editors().then((module) => module.FamilyAnswersEditor),
);

function consentText(at: string | null): string {
  return at ? `Ja, am ${formatBerlinDate(at)}` : "Nein";
}

function ContactList({
  contacts,
  empty,
}: Readonly<{
  contacts: readonly HolidayRegistrationContact[];
  empty: string;
}>) {
  if (contacts.length === 0) {
    return <p className="text-sm text-gray-700">{empty}</p>;
  }
  return (
    <ul className="space-y-1 text-sm text-gray-900">
      {contacts.map((contact, index) => (
        <li key={`${contact.name}-${index}`}>
          <span className="font-medium">{contact.name}</span>
          {contact.relationship ? ` (${contact.relationship})` : ""}
          {contact.phone ? `, ${contact.phone}` : ""}
        </li>
      ))}
    </ul>
  );
}

export default function TraegerHolidayRegistrationPage() {
  const periodId = useParams<{ id: string }>()?.id ?? "";
  // `useSearchParams` braucht eine Suspense-Grenze; bis dahin steht derselbe
  // Kopf wie beim Laden.
  return (
    <Suspense
      fallback={
        <TenantPage
          info={REGISTRATION_INFO}
          title="Anmeldung"
          leading={
            <ConceptIconTile concept={holidayWeeksConcept} size="page" />
          }
          back
          backHref={traegerPath(`/traeger/ferien/${periodId}/anmeldungen`)}
          backLabel="Zurück zu den Anmeldungen"
          loading
        />
      }
    >
      <HolidayRegistrationContent />
    </Suspense>
  );
}

function HolidayRegistrationContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The chosen tab shows at once; the address follows for a bookmark.
  const [chosenTab, setChosenTab] = useState<RegistrationTab | null>(null);
  const search = searchParams?.toString() ?? "";
  // Browser history and links own the tab after navigation. The local choice
  // only bridges the short time until `router.replace` updates the address.
  useEffect(() => setChosenTab(null), [pathname, search]);
  const tab = chosenTab ?? registrationTab(searchParams?.get("tab"));
  const changeTab = useCallback(
    (next: RegistrationTab) => {
      setChosenTab(next);
      const query = new URLSearchParams(searchParams?.toString());
      if (next === "uebersicht") query.delete("tab");
      else query.set("tab", next);
      const search = query.toString();
      router.replace(search ? `?${search}` : "?", { scroll: false });
    },
    [router, searchParams],
  );
  const params = useParams<{ id: string; registrationId: string }>();
  const periodId = params?.id ?? "";
  const registrationId = params?.registrationId ?? "";
  const { data: session } = useSession();
  const canSeeHealth = hasPermission(session, TRAEGER_HEALTH_RIGHT);
  const pdf = useHolidayRegistrationPdf({
    periodId,
    registrationId,
    canSeeHealth,
  });
  const canManageBillingSettings = hasPermission(
    session,
    TRAEGER_BILLING_RIGHT,
  );
  const {
    data: period,
    loadError: periodError,
    error: periodFailure,
    refused: periodRefused,
  } = useTraegerHolidayPeriod(periodId);
  // The way to the invoice of this period (#5688), for the billing right only.
  const billingHref = useHolidayPeriodBillingHref(period);
  const ids = periodId && registrationId;
  const registrationReader = useTraegerResource(
    ids ? traegerKeys.holidayRegistration(periodId, registrationId) : null,
    () => fetchHolidayRegistration(periodId, registrationId),
    "die Anmeldung",
  );
  const contributionReader = useTraegerResource(
    ids ? traegerKeys.holidayContribution(periodId, registrationId) : null,
    () => fetchHolidayContribution(periodId, registrationId),
    "die Anmeldung",
  );
  const healthReader = useFreshTraegerResource(
    ids && canSeeHealth
      ? traegerKeys.holidayRegistrationHealth(periodId, registrationId)
      : null,
    () => fetchHolidayRegistrationHealth(periodId, registrationId),
    "die Anmeldung",
  );
  // Whether the Träger asks for the debtor number (#5621).
  const confirmationReader = useTraegerResource(
    traegerKeys.holidayConfirmationSettings(),
    fetchHolidayConfirmationSettings,
    "die Anmeldung",
  );
  // The number the family already has at the Träger, proposed at the
  // confirmation (#6692), and with a number per child each child's (#7007).
  const familyReader = useTraegerResource(
    ids
      ? traegerKeys.holidayFamilyDebtorNumber(periodId, registrationId)
      : null,
    () => fetchHolidayFamilyDebtorNumber(periodId, registrationId),
    "die Anmeldung",
  );
  const readers = [
    registrationReader,
    contributionReader,
    healthReader,
    confirmationReader,
    familyReader,
  ];
  // The page shows the registration once every part of it is there.
  const complete =
    registrationReader.data !== null &&
    contributionReader.data !== null &&
    (!canSeeHealth || healthReader.data !== null) &&
    confirmationReader.data !== null &&
    familyReader.data !== null;
  const registration = complete ? registrationReader.data : null;
  const health = canSeeHealth ? healthReader.data : null;
  const confirmation = confirmationReader.data;
  const familyDebtorNumbers = familyReader.data ?? NO_FAMILY_DEBTOR_NUMBERS;
  const readersError = readers.find((reader) => reader.error)?.error ?? null;
  // The exemption the confirmation applies and the cost bearer that pays
  // instead of the family (#5627); `null` follows the parents' statement
  // and the contribution the page read.
  const [choice, setChoice] = useState<{
    readonly exemption: boolean;
    readonly costBearerId: string | null;
  } | null>(null);
  const exemption =
    choice?.exemption ?? registrationReader.data?.benefitsDeclared ?? false;
  const costBearerId = choice?.costBearerId ?? null;
  // The contribution computed for the choice; `null` shows the one read.
  const [preview, setPreview] = useState<HolidayContribution | null>(null);
  const contribution = preview ?? contributionReader.data;
  // While the preview is computed again, the confirmation waits for it: it
  // must freeze the amount the card shows.
  const [previewPending, setPreviewPending] = useState(false);
  const latestContribution = useRef(0);
  // The open draft of the registration: an edit state "guardians",
  // "contacts", "answers" or "child:<id>", or the rebooking "rebook:<id>".
  // One at a time: each draft opens on the answer of the save before it,
  // so a second save is never refused for the first one (ADR 0311).
  const [editing, setEditing] = useState<string | null>(null);
  const {
    schools,
    error: schoolsError,
    fetchError: schoolsFailure,
    refused: schoolsRefused,
  } = useTraegerSchools();
  const previewLoad = useApiLoadError();
  const { show: showLoadError, clear: clearPreviewError } = previewLoad;

  // Reads the registration with all its parts and rejects on failure: after
  // a write the page shows that as a load error above the registration. The
  // parts change together, so they show only when every read succeeded.
  const { mutate: mutateRegistration } = registrationReader;
  const { mutate: mutateContribution } = contributionReader;
  const { mutate: mutateHealth } = healthReader;
  const { mutate: mutateConfirmation } = confirmationReader;
  const { mutate: mutateFamily } = familyReader;
  const registrationGuard = useRefusalGuard(
    ids ? traegerKeys.holidayRegistration(periodId, registrationId) : null,
  );
  const beginRegistrationRead = useSWRRequestGuard();
  const readRegistration = useCallback(async () => {
    const complete = beginRegistrationRead(
      ids ? traegerKeys.holidayRegistration(periodId, registrationId) : null,
    );
    try {
      const [
        loadedRegistration,
        loadedContribution,
        loadedHealth,
        loadedConfirmation,
        loadedFamilyDebtorNumber,
      ] = await Promise.all([
        fetchHolidayRegistration(periodId, registrationId),
        fetchHolidayContribution(periodId, registrationId),
        canSeeHealth
          ? fetchHolidayRegistrationHealth(periodId, registrationId)
          : Promise.resolve(null),
        fetchHolidayConfirmationSettings(),
        fetchHolidayFamilyDebtorNumber(periodId, registrationId),
      ]);
      complete(() => registrationGuard.callbacks.onSuccess());
      const fresh = { revalidate: false } as const;
      latestContribution.current++;
      setPreviewPending(false);
      setPreview(null);
      setChoice(null);
      await Promise.all([
        mutateRegistration(loadedRegistration, fresh),
        mutateContribution(loadedContribution, fresh),
        loadedHealth ? mutateHealth(loadedHealth, fresh) : undefined,
        mutateConfirmation(loadedConfirmation, fresh),
        mutateFamily(loadedFamilyDebtorNumber, fresh),
      ]);
      return {
        registration: loadedRegistration,
        familyNumbers: loadedFamilyDebtorNumber,
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        complete(() => {
          registrationGuard.callbacks.onError(error);
          void mutateRegistration(undefined, { revalidate: false });
          void mutateContribution(undefined, { revalidate: false });
          void mutateHealth(undefined, { revalidate: false });
          void mutateFamily(undefined, { revalidate: false });
        });
      }
      throw error;
    }
  }, [
    beginRegistrationRead,
    ids,
    registrationGuard.callbacks,
    periodId,
    registrationId,
    canSeeHealth,
    mutateRegistration,
    mutateContribution,
    mutateHealth,
    mutateConfirmation,
    mutateFamily,
  ]);
  const fetchRegistration = useCallback(
    async () => (await readRegistration()).registration,
    [readRegistration],
  );
  // The status card settles the children's numbers on the read a refusal
  // started (ADR 0311).
  const readFamilyNumbers = useCallback(
    async () => (await readRegistration()).familyNumbers,
    [readRegistration],
  );

  // A change of the bookings or of the exemption changes what a confirmation
  // would freeze, so the contribution is read again; only the newest answer
  // is shown.
  const refreshContribution = useCallback(
    async (withExemption: boolean, withCostBearer: string | null) => {
      const request = ++latestContribution.current;
      setPreviewPending(true);
      clearPreviewError();
      try {
        const next = await fetchHolidayContribution(
          periodId,
          registrationId,
          withCostBearer ? false : withExemption,
          withCostBearer ?? undefined,
        );
        if (request === latestContribution.current) {
          setPreview(next);
          setPreviewPending(false);
        }
      } catch (err) {
        if (request !== latestContribution.current) return;
        setPreviewPending(false);
        logger.warn("traeger_holiday_contribution_refresh_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        await showLoadError(err, {
          object: "der Ferienbeitrag",
          retry: () => void refreshContribution(withExemption, withCostBearer),
        });
      }
    },
    [clearPreviewError, periodId, registrationId, showLoadError],
  );

  const changed = useCallback(
    (next: HolidayRegistrationDetail) => {
      void mutateRegistration(next, { revalidate: false });
      void refreshContribution(exemption, costBearerId);
    },
    [exemption, costBearerId, mutateRegistration, refreshContribution],
  );

  const saved = useCallback(
    (next: HolidayRegistrationDetail) => {
      setEditing(null);
      changed(next);
    },
    [changed],
  );

  // Siblings from another registration (#5628): split after asking.
  const [confirmingSplit, setConfirmingSplit] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const splitErrors = useApiErrorDisplay();
  const { success } = useToast();
  // The page owns reload errors so they survive cards closing on refusal.
  // A confirmed write remains successful even if its reload fails (#6652).
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige der Anmeldung",
    fetchRegistration,
  );
  const splitSiblings = async () => {
    setSplitting(true);
    try {
      await splitHolidaySibling(periodId, registrationId);
    } catch (err) {
      logger.error("holiday_registration_sibling_split_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setConfirmingSplit(false);
      setSplitting(false);
      void splitErrors.show(err, { object: "die Geschwistergruppe" });
      return;
    }
    success("Die Anmeldung ist von den Geschwistern getrennt.");
    setConfirmingSplit(false);
    await afterWrite.refresh();
    setSplitting(false);
  };

  const changeExemption = useCallback(
    (next: boolean) => {
      setChoice({ exemption: next, costBearerId: null });
      void refreshContribution(next, null);
    },
    [refreshContribution],
  );

  const changeCostBearer = useCallback(
    (next: string | null) => {
      setChoice({ exemption, costBearerId: next });
      if (next) void refreshContribution(false, next);
    },
    [exemption, refreshContribution],
  );

  // Confirmed data stays after transient failures; refusals remove it
  // (#6652).
  const loadError =
    (registration ? null : (afterWrite.error ?? readersError)) ??
    metadataLoadError(
      periodError ?? schoolsError,
      Boolean(registration),
      periodFailure,
      schoolsFailure,
    );
  // A refused metadata read removes the content. Its dependent controls must
  // disappear with it, rather than act on a registration no longer accessible.
  const metadataRefused = periodRefused || schoolsRefused;
  const names = schoolNames(schools);
  const known = useHolidayKnownChildren(
    periodId,
    registrationId,
    knownChildrenKey(registration?.children),
  );
  // The health answers join the registration's answers, marked
  // "(Gesundheit)"; a child's stand in its Gesundheit box.
  const view = registration
    ? withHolidayHealthAnswers(registration, health)
    : null;
  const emergency = (registration?.contacts ?? []).filter(
    (contact) => contact.kind === "emergency",
  );
  const pickup = (registration?.contacts ?? []).filter(
    (contact) => contact.kind === "pickup",
  );

  const cancelled = registration?.status === "cancelled";
  const editAction = (section: string, label: string) =>
    cancelled || editing ? undefined : (
      <Button
        type="button"
        variant="outline"
        size="md"
        aria-label={label}
        tooltip="Öffnet diese Angaben zum Bearbeiten, ohne Nachricht an die Eltern."
        onClick={() => setEditing(section)}
      >
        Bearbeiten
      </Button>
    );
  const editorProps = registration
    ? {
        periodId,
        registration,
        onSaved: saved,
        onCancel: () => setEditing(null),
        reload: fetchRegistration,
      }
    : null;

  // Der Titel nennt die Eltern, nicht die Datenbanknummer. Die Nummer bleibt
  // in der Statuszeile: Export und Hinweis auf Doppelanmeldungen verweisen
  // mit „Anmeldung Nr.“ auf sie.
  const title = registration
    ? `Anmeldung von ${registration.guardianFirstName} ${registration.guardianLastName}`
    : "Anmeldung";

  const deletionNotice = registration
    ? holidayRegistrationDeletionNotice(registration)
    : null;

  const head = {
    title,
    leading: <ConceptIconTile concept={holidayWeeksConcept} size="page" />,
    back: true,
    backHref: traegerPath(`/traeger/ferien/${periodId}/anmeldungen`),
    backLabel: "Zurück zu den Anmeldungen",
  } as const;

  // Without the registration the page shows its loading or error state. With
  // it, a recoverable error stands above the content (`keepContent`).
  if (!(registration && view)) {
    return (
      <TenantPage
        info={REGISTRATION_INFO}
        {...head}
        statsLoading={!loadError}
        error={loadError}
        loading={!loadError}
      />
    );
  }

  // Metadata is needed for the cards, but the registration still owns its
  // head while the period or schools are loading again. Cached metadata no
  // longer permits rendering after its revalidation refused access.
  const metadataReady = Boolean(period && schools) && !metadataRefused;
  const tabContent: Record<
    Exclude<RegistrationTab, "uebersicht">,
    ReactNode
  > = {
    kind: (
      <>
        {view.children.map((child) => (
          <HolidayRegistrationChildCard
            key={child.id}
            period={period!}
            registration={view}
            child={child}
            health={health?.children.find(
              (entry) => entry.childId === child.id,
            )}
            healthHidden={
              !canSeeHealth && registration.healthConsentAt !== null
            }
            names={names}
            knownSchoolId={known.get(child.id)}
            onChanged={changed}
            reload={fetchRegistration}
            rebookBlocked={editing !== null && editing !== `rebook:${child.id}`}
            onRebookingChange={(open) =>
              setEditing(open ? `rebook:${child.id}` : null)
            }
            onEdit={
              cancelled || editing
                ? undefined
                : () => setEditing(`child:${child.id}`)
            }
            editor={
              editing === `child:${child.id}` && editorProps ? (
                <ChildEditor
                  {...editorProps}
                  child={
                    registration.children.find(
                      (entry) => entry.id === child.id,
                    ) ?? child
                  }
                  schools={schools!}
                />
              ) : undefined
            }
          />
        ))}
        {editing === "answers" && editorProps ? (
          <FamilyAnswersEditor {...editorProps} />
        ) : registration.form.fields.length > 0 ? (
          <SectionCard
            title="Allgemeine Angaben"
            description={`Antworten auf die Fragen aus Formular-Version ${registration.form.version}. Antworten zu einem Kind stehen beim Kind.`}
            action={
              editableQuestions(registration.form.fields, false).length > 0
                ? editAction("answers", "Allgemeine Angaben bearbeiten")
                : undefined
            }
          >
            {answeredQuestions(registration.form.fields, false, view.answers)
              .length > 0 ? (
              <HolidayRegistrationAnswers
                questions={answeredQuestions(
                  registration.form.fields,
                  false,
                  view.answers,
                )}
                answers={view.answers}
              />
            ) : (
              <p className="text-sm text-gray-700">
                Keine allgemeinen Antworten.
              </p>
            )}
          </SectionCard>
        ) : null}
        {registration.form.legalBlocks?.some((block) => block.enabled) ? (
          <SectionCard title="Hinweise und Einwilligungen">
            <div className="space-y-4">
              {registration.form.legalBlocks
                .filter((block) => block.enabled)
                .map((block) => {
                  const at = registration.legalAcceptances?.[block.key];
                  return (
                    <div key={block.key}>
                      <SectionLabel as="h3">{block.title}</SectionLabel>
                      <p className="text-sm text-gray-700">{block.label}</p>
                      {block.text.trim() ? (
                        <div className="mt-2 text-sm text-gray-700">
                          <LegalMarkdown text={block.text} />
                        </div>
                      ) : null}
                      {block.kind === "notice" && !block.required ? null : (
                        <p className="text-sm text-gray-700">
                          {legalBlockState(
                            at,
                            registration.legalWithdrawals?.[block.key],
                          )}
                        </p>
                      )}
                      {block.kind === "consent" && at ? (
                        <HolidayConsentWithdrawButton
                          periodId={periodId}
                          registrationId={registration.id}
                          consentKey={block.key}
                          title={block.title}
                          onChanged={changed}
                        />
                      ) : null}
                      <DocumentAttachmentList
                        labels={PDF_LABELS}
                        attachments={block.attachments}
                        loadDocument={(documentId) =>
                          fetchHolidayDocument(periodId, documentId)
                        }
                      />
                    </div>
                  );
                })}
            </div>
          </SectionCard>
        ) : null}
        {editing === "contacts" && editorProps ? (
          <ContactsEditor {...editorProps} />
        ) : (
          <SectionCard
            title="Notfallkontakte und Abholung"
            action={editAction(
              "contacts",
              "Notfallkontakte und Abholung bearbeiten",
            )}
          >
            <div className="space-y-4">
              <div className="space-y-1">
                <SectionLabel as="h3">Notfallkontakte</SectionLabel>
                <ContactList contacts={emergency} empty="Keine Angabe." />
              </div>
              <div className="space-y-1">
                <SectionLabel as="h3">Abholberechtigte</SectionLabel>
                <ContactList
                  contacts={pickup}
                  empty="Keine Angabe. Dann holen nur die Eltern ab."
                />
              </div>
            </div>
          </SectionCard>
        )}
      </>
    ),
    eltern: (
      <>
        {editing === "guardians" && editorProps ? (
          <GuardiansEditor
            {...editorProps}
            invoiced={contribution?.invoiced ?? false}
          />
        ) : (
          <SectionCard
            id={PARENTS_SECTION_ID}
            concept={parentsConcept}
            title="Eltern"
            description={cancelled ? CANCELLED_EDIT_TEXT : undefined}
            action={editAction("guardians", "Angaben der Eltern bearbeiten")}
          >
            <DataGrid>
              <DataField label="Name">
                {registration.guardianFirstName} {registration.guardianLastName}
              </DataField>
              <DataField label="Telefon">
                {registration.guardianPhone}
              </DataField>
              <DataField label="E-Mail" fullWidth>
                {registration.guardianEmail}
              </DataField>
              {registration.guardianAddress ? (
                <DataField label="Anschrift" fullWidth>
                  {registration.guardianAddress.street},{" "}
                  {registration.guardianAddress.postalCode}{" "}
                  {registration.guardianAddress.city}
                </DataField>
              ) : null}
              <DataField label="Datenschutz zugestimmt">
                {consentText(registration.privacyConsentAt)}
              </DataField>
              <DataField label="Gesundheitsangaben zugestimmt">
                {consentText(registration.healthConsentAt)}
              </DataField>
              <DataField label="Verbindlich angemeldet">
                {consentText(registration.bindingConfirmedAt)}
              </DataField>
              <HolidayDeclarationFields registration={registration} />
            </DataGrid>
          </SectionCard>
        )}
        {registration.secondGuardian && editing !== "guardians" ? (
          <SectionCard
            title="Zweite sorgeberechtigte Person"
            action={editAction(
              "guardians",
              "Angaben der zweiten sorgeberechtigten Person bearbeiten",
            )}
          >
            <DataGrid>
              <DataField label="Name">
                {registration.secondGuardian.firstName}{" "}
                {registration.secondGuardian.lastName}
              </DataField>
              <DataField label="E-Mail">
                {registration.secondGuardian.email || "Nicht angegeben"}
              </DataField>
              <DataField label="Telefon">
                {registration.secondGuardian.phone || "Nicht angegeben"}
              </DataField>
            </DataGrid>
          </SectionCard>
        ) : null}
        <HolidayDeclarationTextsCard registration={registration} />
        {/* Every mail of the registration with its status (#6976), in the
            view of the mails of an enrollment request. The next step stands
            once, in the notice at the top (#6999). */}
        <RequestMailStatus
          mails={(registration.mails ?? []).map((mail) => ({
            kind: mail.kind,
            outcome: mail.outcome,
            ...(mail.createdAt ? { created_at: mail.createdAt } : {}),
          }))}
          loadError={null}
          title="Mails an die Eltern"
          labels={HOLIDAY_MAIL_LABELS}
        />
      </>
    ),
    nachweise: (
      <>
        <HolidayRegistrationProofCard
          periodId={periodId}
          registration={registration}
          onUploaded={(next) =>
            void mutateRegistration(next, { revalidate: false })
          }
        />
        {contribution &&
        (registration.status !== "cancelled" || contribution.frozen) ? (
          <HolidayContributionCard
            contribution={contribution}
            registration={registration}
            canManageBillingSettings={canManageBillingSettings}
          />
        ) : null}
      </>
    ),
  };
  // Keep the active form mounted when its tab is not selected. Its draft is
  // local state, so removing the tab would silently reset unsaved changes.
  const editingTab =
    editing === "guardians" ? "eltern" : editing ? "kind" : null;

  return (
    <HolidayRegistrationStatusScope
      periodId={periodId}
      registration={registration}
      contribution={contribution}
      previewPending={previewPending}
      debtorNumberRequired={confirmation?.debtorNumberRequired ?? false}
      debtorNumberFormat={confirmation?.debtorNumberFormat}
      familyDebtorNumber={familyDebtorNumbers.debtorNumber}
      childDebtorNumbers={familyDebtorNumbers.children}
      childNumbersVersion={familyDebtorNumbers.version}
      exemption={exemption}
      onExemptionChange={changeExemption}
      costBearers={confirmation?.costBearers}
      costBearerId={costBearerId}
      onCostBearerChange={changeCostBearer}
      onChanged={changed}
      onReload={afterWrite.refresh}
      onDebtorNumberChanged={afterWrite.refresh}
      onRead={readFamilyNumbers}
      onFamilyNumbersSaved={(stored) =>
        mutateFamily(stored, { revalidate: false })
      }
      canManageBillingSettings={canManageBillingSettings}
      billingHref={billingHref}
      onReveal={() => changeTab("uebersicht")}
      cardShown={tab === "uebersicht"}
      onRevealChildren={() => changeTab("kind")}
    >
      {(status) => (
        <TenantPage
          info={REGISTRATION_INFO}
          {...head}
          error={loadError}
          stats={
            <TenantPageStats
              items={[
                { label: `Nr. ${registration.id}` },
                ...(period && !periodRefused ? [{ label: period.name }] : []),
                {
                  label: `Eingegangen am ${formatBerlinDate(registration.submittedAt)}`,
                },
              ]}
            />
          }
          loading={!metadataReady && !loadError}
          actions={
            <>
              {/* Der Status steht als Plakette neben der Kopfaktion, nicht in
                  der Statuszeile (#7402). */}
              <StatusBadge
                tone={HOLIDAY_REGISTRATION_STATUS_TONES[registration.status]}
                label={HOLIDAY_REGISTRATION_STATUS_LABELS[registration.status]}
              />
              {registration.frozen ? (
                <StatusBadge tone="gray" label="Eingefroren" />
              ) : null}
              {metadataRefused ? null : status.confirmAction}
            </>
          }
          // Everything but „Bestätigen“ stands in the menu of the head,
          // the download under „Herunterladen“ (#7410).
          overflowMenu={
            metadataRefused
              ? undefined
              : [
                  ...status.menuItems,
                  ...exportMenuItems({
                    options: pdf.options,
                    busyKey: pdf.busyKey,
                    onSelect: (option) => void pdf.download(option.key),
                  }),
                  ...(status.cancelItems.length > 0
                    ? [{ kind: "separator" as const }, ...status.cancelItems]
                    : []),
                ]
          }
          tabs={
            metadataRefused
              ? undefined
              : {
                  value: tab,
                  onChange: (next) => changeTab(registrationTab(next)),
                  label: "Bereiche der Anmeldung",
                  inUrl: true,
                  items: REGISTRATION_TABS,
                }
          }
          overlays={
            metadataRefused ? undefined : (
              <>
                {status.overlays}
                <ConfirmationModal
                  isOpen={confirmingSplit}
                  title="Von den Geschwistern trennen?"
                  confirmText="Trennen"
                  isConfirmLoading={splitting}
                  loadingText="Trennt …"
                  onClose={() => setConfirmingSplit(false)}
                  onConfirm={() => void splitSiblings()}
                >
                  <p className="text-sm text-gray-700">
                    Die Kinder dieser Anmeldung zählen dann nicht mehr mit den
                    anderen Anmeldungen zusammen. moto berechnet den
                    Ferienbeitrag neu, auch einen schon bestätigten. Eltern
                    bekommen keine Nachricht von moto.
                  </p>
                </ConfirmationModal>
              </>
            )
          }
        >
          <LoadErrorAlert error={previewLoad.error ?? readersError} />
          <LoadErrorAlert error={afterWrite.error} />
          {metadataReady ? (
            <HolidayRegistrationMailProblemsAlert
              problems={registration.mailProblems}
              outcomes={(registration.mails ?? []).map((mail) => mail.outcome)}
              cancelled={cancelled}
              parentsSectionId={PARENTS_SECTION_ID}
              revealParents={() => changeTab("eltern")}
            />
          ) : null}
          {metadataReady && tab === "uebersicht" ? (
            <>
              {deletionNotice ? (
                <Alert type="info" message={deletionNotice} />
              ) : null}
              {status.card}
              <HolidayRegistrationCriteriaCard
                periodId={periodId}
                registration={registration}
                onChanged={changed}
              />
              {contribution?.siblings?.length ? (
                <SectionCard
                  title="Geschwister"
                  description="Die Kinder dieser Anmeldungen zählen beim Ferienbeitrag zusammen. Welches Kind das 1. Kind ist, steht in den Einstellungen unter Allgemein im Bereich Ferienbetreuung."
                  action={
                    contribution.siblingsInvoiced ? undefined : (
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        tooltip="moto fragt vorher nach, dann zählen die Kinder einzeln beim Ferienbeitrag."
                        onClick={() => setConfirmingSplit(true)}
                      >
                        Trennen
                      </Button>
                    )
                  }
                >
                  <div className="space-y-2 text-sm text-gray-700">
                    <ul className="space-y-1">
                      {contribution.siblings.map((sibling) => (
                        <li
                          key={sibling.registrationId}
                          className="wrap-anywhere"
                        >
                          <NavigationLink
                            href={traegerPath(
                              `/traeger/ferien/${periodId}/anmeldungen/${sibling.registrationId}`,
                            )}
                            className="font-medium text-gray-900 underline"
                          >
                            Anmeldung Nr. {sibling.registrationId}
                          </NavigationLink>
                          {": "}
                          {sibling.children
                            .map((child) => child.name)
                            .join(", ")}
                          {sibling.cancelled
                            ? " (storniert, zählt nicht mit)"
                            : null}
                        </li>
                      ))}
                    </ul>
                    {contribution.siblingsInvoiced ? (
                      <p>
                        Für eine dieser Anmeldungen gibt es schon eine Rechnung.
                        Geschwister kannst du jetzt nicht mehr ändern.
                      </p>
                    ) : null}
                  </div>
                </SectionCard>
              ) : null}
              <HolidayRegistrationHistory
                period={period!}
                names={names}
                registration={registration}
              />
            </>
          ) : null}
          {metadataReady && (tab === "kind" || editingTab === "kind") ? (
            <div key="kind" hidden={tab !== "kind"}>
              {tabContent.kind}
            </div>
          ) : null}
          {metadataReady && (tab === "eltern" || editingTab === "eltern") ? (
            <div key="eltern" hidden={tab !== "eltern"}>
              {tabContent.eltern}
            </div>
          ) : null}
          {metadataReady && tab === "nachweise" ? tabContent.nachweise : null}
        </TenantPage>
      )}
    </HolidayRegistrationStatusScope>
  );
}

/**
 * Whether the parents agreed to a legal block: since when, or since when
 * they withdrew a voluntary consent in the parents portal (#8038).
 */
function legalBlockState(
  acceptedAt: string | undefined,
  withdrawnAt: string | undefined,
): string {
  if (acceptedAt) return `Zugestimmt am ${formatChatDateTime(acceptedAt)} Uhr`;
  if (withdrawnAt) {
    return `Von den Eltern widerrufen am ${formatChatDateTime(withdrawnAt)} Uhr`;
  }
  return "Nicht zugestimmt";
}
