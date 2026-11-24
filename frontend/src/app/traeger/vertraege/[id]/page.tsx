"use client";

// Ein Betreuungsvertrag (#4678, ADR 0153): was der Vertrag festhält, an wen
// er geht, wann er versendet wurde, und das PDF, das die Eltern bekommen.
// Ein Entwurf lässt sich senden oder verwerfen; ein versendeter Vertrag
// behält sein PDF und lässt sich erneut senden. Ein abgeschlossener Vertrag
// (#4680) zeigt, wann und wie er zustande kam; erneut senden lässt er sich mit demselben PDF.

import { useTraegerModuleBooked } from "~/lib/traeger-booked-modules";
import { FamilyBillingStatusCard } from "~/components/traeger/family-billing-status-card";
import { SepaMandateStatusCard } from "~/components/traeger/sepa-mandate-status-card";
import {
  Download,
  Link2,
  RotateCw,
  Send,
  Trash2,
  Unlink,
  Unplug,
} from "lucide-react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  CONTRACT_STATUS_LABELS,
  contractStatusTone,
  MAIL_STATE_LABELS,
  MAIL_STATE_TONES,
  SEND_SKIP_LABELS,
  childName,
  formatConclusion,
  formatService,
  knownConclusionAt,
  handedOverOnPaper,
  serviceDays,
} from "~/components/traeger/care-contract-format";
import { CareContractChangeCard } from "~/components/traeger/care-contract-change-card";
import { CareContractCorrectionsCard } from "~/components/traeger/care-contract-corrections-card";
import { CareContractChildLinkModal } from "~/components/traeger/care-contract-child-link-modal";
import {
  CONTRACT_DELIVERY_SECTION_ID,
  CONTRACT_DETAIL_TABS,
  CONTRACT_VERSIONS_SECTION_ID,
  ContractDetailTabsProvider,
  ContractSectionJump,
  type ContractDetailTab,
  parseContractDetailTab,
} from "~/components/traeger/care-contract-detail-tabs";
import {
  CareContractNoticeCard,
  NoticeCardJump,
} from "~/components/traeger/care-contract-notice-card";
import {
  CareContractVersions,
  plannedVersion,
  plannedVersionText,
} from "~/components/traeger/care-contract-versions";
import { CareContractSignatureCard } from "~/components/traeger/care-contract-signature-card";
import {
  useFreshTraegerResource,
  useTraegerResource,
} from "~/components/traeger/use-traeger-resource";
import { EmailText } from "~/components/traeger/email-text";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  OverflowMenu,
  type OverflowMenuItem,
} from "~/components/ui/page-header/OverflowMenu";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { ConfirmationModal } from "~/components/ui/modal";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { Input } from "~/components/ui/input";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { PdfPreview } from "~/components/ui/pdf-preview";
import { SectionCard } from "~/components/ui/section-card";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { fetchContractChanges } from "~/lib/care-contract-changes-api";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { careContractsConcept } from "~/lib/concepts/careContracts";
import { careTimesConcept } from "~/lib/concepts/careTimes";
import { parentsConcept } from "~/lib/concepts/parents";
import {
  formatBerlinDate,
  formatBerlinTime,
  formatDate,
} from "~/lib/date-helpers";
import { mailStatusCopy } from "~/lib/email-delivery-status";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { downloadBlob } from "~/lib/file-download";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerContractKeys } from "~/lib/swr/traeger-contract-keys";
import {
  type CareContractDetail,
  discardCareContract,
  downloadCareContract,
  fetchCareContract,
  sendCareContracts,
  resendCareContract,
} from "~/lib/traeger-care-contracts-api";
import { unlinkContractChild } from "~/lib/traeger-contract-child-links-api";
import { unbindContractEnrollment } from "~/lib/traeger-contract-enrollments-api";
import { traegerPath } from "~/lib/traeger-url";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { labelOf } from "~/lib/label-of";

const logger = createLogger({ component: "TraegerVertragPage" });

/** Was die Seite ist und was man dort zuerst tut (#7595). */
const CONTRACT_INFO =
  "Hier siehst du den Vertrag eines Kindes. Prüfe im Reiter „Vertrag“ zuerst die „Gebuchte Betreuung“, den „Beginn“ und den „Beitrag im Monat“. Im Reiter „Unterschrift und Versand“ siehst du, ob die Eltern unterschrieben haben.";

const LIST_HREF = traegerPath("/traeger/vertraege");

export default function TraegerVertragPage() {
  // `useSearchParams` braucht eine Suspense-Grenze.
  return (
    <Suspense
      fallback={
        <TenantPage
          info={CONTRACT_INFO}
          title="Vertrag"
          back
          backHref={LIST_HREF}
          backLabel="Zurück zu den Verträgen"
          loading
        />
      }
    >
      <TraegerVertragView />
    </Suspense>
  );
}

function TraegerVertragView() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The tab stands in the address, so a bookmark opens it again (#7408). A
  // click shows it at once; the address follows. Until it does, the click
  // holds; an address that changes otherwise (back, a link) wins.
  const addressedTab = parseContractDetailTab(searchParams?.get("tab"));
  const [clicked, setClicked] = useState<{
    contractId: string;
    tab: ContractDetailTab;
    from: ContractDetailTab;
  } | null>(null);
  const activeTab =
    clicked && clicked.contractId === id && clicked.from === addressedTab
      ? clicked.tab
      : addressedTab;
  useEffect(() => {
    // The optimistic tab only bridges the router update. Once the address or
    // contract changes, it must not override a later browser navigation.
    setClicked(null);
  }, [addressedTab, id]);
  const openTab = (next: ContractDetailTab) => {
    setClicked({ contractId: id, tab: next, from: addressedTab });
    const query = new URLSearchParams(searchParams?.toString());
    if (next === "vertrag") query.delete("tab");
    else query.set("tab", next);
    const queryString = query.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  };
  const {
    data: contract,
    loading,
    error: loadError,
    refused,
    mutate,
    reload,
    readCallbacks,
  } = useFreshTraegerResource(
    id ? traegerContractKeys.contract(id) : null,
    () => fetchCareContract(id),
    "der Vertrag",
  );
  const invalidateFamily = useInvalidateFamily();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [linkingChild, setLinkingChild] = useState(false);
  // The child record the dialog was opened for: the confirmation removes
  // this link, not one a colleague stored meanwhile.
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  // The enrollment the dialog was opened for (ADR 0309, „Der Weg zurück“):
  // the confirmation takes off this binding, not one made meanwhile.
  const [confirmUnbind, setConfirmUnbind] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState(false);
  const actionError = useApiErrorDisplay();
  const discardErrors = useApiFormError();
  const recipientForm = useRef<HTMLFormElement>(null);
  const recipientErrors = useApiFormError(recipientForm);
  const [recipientEmail, setRecipientEmail] = useState("");
  const { success, warning } = useToast();
  const today = useBerlinToday();

  // A refusal takes the contract away, and with it what was typed for it.
  const [wasRefused, setWasRefused] = useState(refused);
  if (refused !== wasRefused) {
    setWasRefused(refused);
    if (refused) {
      setRecipientEmail("");
      setConfirmDiscard(false);
      setLinkingChild(false);
      setConfirmUnlink(null);
      setConfirmUnbind(null);
    }
  }

  // A new Berlin day can put another version in force: read the contract
  // again, so booked care, contribution and PDF follow it (#4681).
  const readOnDay = useRef(today);
  useEffect(() => {
    if (readOnDay.current === today) return;
    readOnDay.current = today;
    reload();
  }, [today, reload]);

  // Reload after a send: a failure there is a load error above the contract,
  // not a failed send (#6652). The list shows the new state too.
  const afterSend = useRefreshAfterWrite(
    "die Anzeige des Vertrags",
    async () => {
      void invalidateFamily(traegerContractKeys.listFamily);
      await mutate(
        fetchCareContract(id).then(
          (data) => {
            readCallbacks.onSuccess();
            return data;
          },
          (err: unknown) => {
            readCallbacks.onError(err);
            throw err;
          },
        ),
        { revalidate: false },
      );
    },
  );

  // After a write on a card: the contract, and the list with its state.
  const afterCardWrite = async () => {
    void invalidateFamily(traegerContractKeys.listFamily);
    // A link or its removal changes which children an imported contract
    // covers in „Verträge erstellen“.
    void invalidateFamily(traegerContractKeys.candidates());
    await mutate();
  };

  // The preview follows the stored PDF once the contract is sent. It is
  // optional: the download button offers the PDF and reports its own error.
  const { data: pdf } = useFreshTraegerResource(
    contract
      ? traegerContractKeys.contractPdf(
          id,
          contract.version.number,
          contract.documentFrozen,
        )
      : null,
    () => downloadCareContract(id),
    "die Vorschau",
  );
  useEffect(() => {
    if (!pdf) {
      setPdfUrl(null);
      return;
    }
    const url = URL.createObjectURL(pdf.blob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdf]);

  const refreshDelivery = async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  };

  const send = async () => {
    if (!contract) return;
    setSending(true);
    let result: Awaited<ReturnType<typeof sendCareContracts>>;
    try {
      result = await sendCareContracts([contract.id]);
    } catch (err) {
      logger.error("traeger_care_contract_send_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionError.show(err, { object: "der Vertrag" });
      setSending(false);
      return;
    }
    const skip = result.skipped[0];
    if (skip) warning(`Nicht gesendet: ${SEND_SKIP_LABELS[skip.reason]}.`);
    else
      success(
        contract.mailings.length === 0
          ? "Der Vertrag ist unterwegs: per Mail und in die Eltern-App."
          : "Der Vertrag ist noch einmal unterwegs.",
      );
    await afterSend.refresh();
    setSending(false);
  };

  const resendToAddress = async () => {
    if (!contract) return;
    recipientErrors.clear();
    setSending(true);
    let result: Awaited<ReturnType<typeof resendCareContract>>;
    try {
      result = await resendCareContract(contract.id, recipientEmail);
    } catch (err) {
      logger.error("traeger_care_contract_recipient_retry_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void recipientErrors.show(err, { object: "die Versandadresse" });
      setSending(false);
      return;
    }
    const skip = result.skipped[0];
    if (skip) warning(`Nicht gesendet: ${SEND_SKIP_LABELS[skip.reason]}.`);
    else success("Der Vertrag ist an die neue Adresse unterwegs.");
    setRecipientEmail("");
    await afterSend.refresh();
    setSending(false);
  };

  const unlinkChild = async () => {
    // The child record the office saw when it opened the dialog.
    const studentId = confirmUnlink;
    if (!studentId) return;
    setUnlinking(true);
    try {
      await unlinkContractChild(id, studentId);
    } catch (err) {
      setUnlinking(false);
      if (
        err instanceof ApiError &&
        (err.code === wireErrorCode("care_contract.child_link_changed") ||
          err.code === wireErrorCode("care_contract.child_link_bound"))
      ) {
        // Expected refusals: another child record is linked by now, or the
        // contract was bound to its enrollment meanwhile. Show the contract
        // as it is, so the office decides again.
        void actionError.show(err, { object: "die Verknüpfung" });
        setConfirmUnlink(null);
        await afterCardWrite();
        return;
      }
      logger.error("traeger_care_contract_unlink_child_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionError.show(err, { object: "die Verknüpfung" });
      return;
    }
    setConfirmUnlink(null);
    setUnlinking(false);
    success("Die Verknüpfung mit der Kinderakte ist gelöst.");
    await afterCardWrite();
  };

  const unbindEnrollment = async () => {
    // The enrollment the office saw when it opened the dialog.
    const requestChildId = confirmUnbind;
    if (!requestChildId) return;
    setUnbinding(true);
    try {
      await unbindContractEnrollment(id, requestChildId);
    } catch (err) {
      setUnbinding(false);
      if (
        err instanceof ApiError &&
        err.code === wireErrorCode("care_contract.enrollment_binding_changed")
      ) {
        // Expected: the contract is no longer bound to this enrollment.
        // Show it as it is now, so the office decides again.
        void actionError.show(err, { object: "die Bindung" });
        setConfirmUnbind(null);
        await afterCardWrite();
        return;
      }
      logger.error("traeger_care_contract_unbind_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionError.show(err, { object: "die Bindung" });
      return;
    }
    setConfirmUnbind(null);
    setUnbinding(false);
    success("Die Bindung an die Anmeldung ist gelöst.");
    await afterCardWrite();
  };

  const download = async () => {
    try {
      const file = await downloadCareContract(id);
      downloadBlob(file.blob, file.filename);
    } catch (err) {
      logger.error("traeger_care_contract_download_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void actionError.show(err, { object: "das PDF" });
    }
  };

  const discard = async () => {
    setDiscarding(true);
    try {
      await discardCareContract(id);
      // The child waits for a contract again.
      void invalidateFamily(traegerContractKeys.listFamily);
      void invalidateFamily(traegerContractKeys.candidates());
      success("Der Entwurf ist verworfen.");
      router.push(LIST_HREF);
    } catch (err) {
      logger.error("traeger_care_contract_discard_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void discardErrors.show(err, { object: "der Entwurf" });
    } finally {
      setDiscarding(false);
    }
  };

  const isDraft = contract?.status === "entwurf";
  // A contract handed over on paper (#8030) is versendet without a mail:
  // its first mail is no second send.
  const firstMail =
    isDraft ||
    (contract?.status === "versendet" && handedOverOnPaper(contract));
  const billingBooked = useTraegerModuleBooked("elternbeitraege") === true;
  const canSend =
    isDraft || contract?.status === "versendet" || contract?.status === "aktiv";
  const lastMail = contract?.mailings[0];
  const sendBlockedReason = lastMail
    ? contractSendBlockedReason(lastMail, isDraft)
    : undefined;
  const party = contract?.parties[0];
  const comingVersion = contract
    ? plannedVersion(contract.versions, today)
    : undefined;
  // A contract that ends before the coming version starts never gets it.
  const planned =
    comingVersion &&
    contract?.status === "gekuendigt" &&
    contract.endsOn &&
    contract.endsOn < comingVersion.effectiveFrom
      ? undefined
      : comingVersion;
  // An active or ended contract shows its versions, so the office sees where
  // an approved change will appear; a draft has only its first version.
  const showVersions =
    contract !== null &&
    (contract.versions.length > 1 ||
      contract.status === "aktiv" ||
      contract.status === "gekuendigt" ||
      contract.status === "widerrufen" ||
      contract.status === "beendet");

  const sendBlocked =
    sending ||
    refreshing ||
    lastMail?.state === "queued" ||
    (!isDraft && !!lastMail?.sendBlock);
  // An active contract is mostly looked up, not mailed again: its PDF is
  // the visible action, and a new mail sits with the mail history in the
  // card „Versand“, as does checking the delivery.
  const resendInCard = contract?.status === "aktiv";
  const sendInHead = canSend && !resendInCard;
  const refreshInCard = !!contract && !isDraft && contract.mailings.length > 0;

  // A change the parents asked for waits for a decision in the tab
  // „Unterschrift und Versand“; its tab counts it, so it is not overlooked.
  const { data: changes } = useTraegerResource(
    contract?.status === "aktiv" ? traegerContractKeys.changes(id) : null,
    () => fetchContractChanges(id),
    "der Änderungswunsch",
  );
  const pendingChanges = changes?.pending.length ?? 0;

  const headMenu: OverflowMenuItem[] = [];
  // The mail actions of the card „Versand“ are also one tap away from the
  // head: that card sits in its own tab.
  if (refreshInCard) {
    headMenu.push({
      label: "Versand aktualisieren",
      description: "Holt den neuesten Stand der Mails an die Eltern.",
      icon: <RotateCw className="h-4 w-4" aria-hidden="true" />,
      onClick: () => {
        if (!refreshing) void refreshDelivery();
      },
    });
  }
  if (contract && resendInCard && !sendBlocked) {
    headMenu.push({
      label: "Erneut senden",
      description:
        "moto fragt vorher nach, dann geht der Vertrag noch einmal an die Eltern.",
      icon: <Send className="h-4 w-4" aria-hidden="true" />,
      onClick: () => setConfirmingSend(true),
    });
  }
  if (contract && sendInHead) {
    // A draft's PDF is a preview that says so on every page (#8030): the
    // parents sign only the PDF a send or the handover on paper froze.
    headMenu.push({
      label: isDraft ? "Vorschau herunterladen" : "PDF herunterladen",
      description: isDraft
        ? "Speichert die Vorschau als PDF. Sie ist nicht zum Unterschreiben."
        : "Speichert den Vertrag als PDF auf deinem Gerät.",
      icon: <Download className="h-4 w-4" aria-hidden="true" />,
      onClick: () => void download(),
    });
  }
  // Only an imported contract is linked by hand (ADR 0307); one from an
  // application has the child of its application.
  if (contract?.imported && !contract.studentId) {
    headMenu.push({
      label: "Mit Kinderakte verknüpfen",
      description:
        "Zeigt Vertrag und Kinderakte zum Vergleich, dann verknüpfst du.",
      icon: <Link2 className="h-4 w-4" aria-hidden="true" />,
      onClick: () => setLinkingChild(true),
    });
  }
  // A bound contract keeps its child record (ADR 0309): its link comes off
  // only after the binding.
  if (
    contract?.imported &&
    contract.followsBookings &&
    contract.requestChildId
  ) {
    headMenu.push({
      label: "Bindung an die Anmeldung lösen",
      description:
        "moto fragt vorher nach. Die Anmeldung bleibt an der Schule.",
      icon: <Unplug className="h-4 w-4" aria-hidden="true" />,
      onClick: () => setConfirmUnbind(contract?.requestChildId ?? null),
    });
  }
  if (contract?.imported && contract.studentId && !contract.followsBookings) {
    headMenu.push({
      label: "Verknüpfung lösen",
      description:
        "moto fragt vorher nach, dann gehört der Vertrag zu keiner Kinderakte.",
      icon: <Unlink className="h-4 w-4" aria-hidden="true" />,
      onClick: () => setConfirmUnlink(contract?.studentId ?? null),
    });
  }
  if (isDraft) {
    headMenu.push({
      label: "Entwurf verwerfen",
      description: "moto fragt vorher nach, dann wird der Entwurf gelöscht.",
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      destructive: true,
      onClick: () => setConfirmDiscard(true),
    });
  }

  return (
    <TenantPage
      info={CONTRACT_INFO}
      title={contract ? childName(contract) : "Vertrag"}
      leading={<ConceptIconTile concept={careContractsConcept} size="page" />}
      back
      backHref={LIST_HREF}
      backLabel="Zurück zu den Verträgen"
      stats={
        contract ? (
          <TenantPageStats
            items={[
              { label: contract.modulesText || "–" },
              { label: contract.schoolName },
              {
                // A date keeps its word: „ab 01.08.2026“ never parts.
                label: `ab\u00A0${formatDate(contract.effectiveFrom)}${
                  contract.endsOn
                    ? ` bis\u00A0${formatDate(contract.endsOn)}`
                    : ""
                }`,
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      actions={
        <>
          {contract ? (
            <StatusBadge
              label={labelOf(CONTRACT_STATUS_LABELS, contract.status, "–")}
              tone={contractStatusTone(contract)}
            />
          ) : null}
          {contract ? (
            <>
              {sendInHead ? (
                <Button
                  type="button"
                  variant={isDraft ? "success" : "outline"}
                  size="md"
                  disabled={sendBlocked}
                  isLoading={sending}
                  loadingText="Wird gesendet …"
                  tooltip={
                    firstMail
                      ? "moto fragt vorher nach, dann geht der Vertrag per E-Mail und in die Eltern-App."
                      : "moto fragt vorher nach, dann geht der Vertrag noch einmal an die Eltern."
                  }
                  disabledReason={sendBlockedReason}
                  onClick={() => setConfirmingSend(true)}
                >
                  <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                  {firstMail ? "Vertrag senden" : "Erneut senden"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  tooltip="Speichert den Vertrag als PDF auf deinem Gerät."
                  onClick={() => void download()}
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  PDF herunterladen
                </Button>
              )}
              {/* One visible action; the rest waits in the menu (TENANT-PAGE-SPEC
                rule 4). An entry that cannot run right now stays out. */}
              {headMenu.length > 0 ? (
                <OverflowMenu items={headMenu} ariaLabel="Weitere Aktionen" />
              ) : null}
            </>
          ) : null}
        </>
      }
      tabs={
        contract
          ? {
              value: activeTab,
              onChange: (next) => openTab(parseContractDetailTab(next)),
              inUrl: true,
              label: "Bereiche des Vertrags",
              items: CONTRACT_DETAIL_TABS.map((tab) => ({
                ...tab,
                badge:
                  tab.value === "versand" && pendingChanges > 0
                    ? pendingChanges
                    : undefined,
              })),
            }
          : undefined
      }
      error={
        refused
          ? loadError
          : contract
            ? loadError
            : (afterSend.error ?? loadError)
      }
      loading={loading && !afterSend.error}
      overlays={
        <>
          {/* Sending mails the parents at once and cannot be taken back,
              so the button asks first and names who gets it. */}
          <ConfirmationModal
            isOpen={confirmingSend}
            title={
              firstMail ? "Vertrag senden?" : "Vertrag noch einmal senden?"
            }
            confirmText={firstMail ? "Vertrag senden" : "Erneut senden"}
            isConfirmLoading={sending}
            loadingText="Wird gesendet …"
            onClose={() => setConfirmingSend(false)}
            onConfirm={() => {
              setConfirmingSend(false);
              void send();
            }}
          >
            <p className="text-sm text-gray-700">
              {`Der Vertrag geht per Mail an ${party?.email ?? "die Eltern"}${
                party?.hasAccount ? " und in die Eltern-App" : ""
              }.`}{" "}
              Eine gesendete Mail lässt sich nicht zurückholen.
            </p>
          </ConfirmationModal>
          {contract?.imported ? (
            <CareContractChildLinkModal
              contractId={contract.id}
              isOpen={linkingChild}
              onClose={() => setLinkingChild(false)}
              onLinked={() => {
                setLinkingChild(false);
                success("Der Vertrag ist jetzt mit der Kinderakte verknüpft.");
                void afterCardWrite();
              }}
            />
          ) : null}
          <ConfirmationModal
            isOpen={confirmUnlink !== null}
            title="Verknüpfung lösen?"
            confirmText="Verknüpfung lösen"
            confirmVariant="danger"
            confirmTooltip="Löst die Verknüpfung sofort, sonst ändert sich nichts."
            isConfirmLoading={unlinking}
            loadingText="Wird gelöst …"
            onClose={() => setConfirmUnlink(null)}
            onConfirm={() => void unlinkChild()}
          >
            <p className="text-sm text-gray-700">
              {confirmUnlink
                ? `Der Vertrag ist dann nicht mehr mit der Kinderakte Nr. ${confirmUnlink} verknüpft.`
                : "Der Vertrag ist dann mit keiner Kinderakte mehr verknüpft."}{" "}
              Sonst ändert sich nichts: Vertrag, Eltern und Beitrag bleiben.
              Schon ausgestellte Rechnungen bleiben, wie sie sind. Eltern
              bekommen keine Nachricht.
            </p>
          </ConfirmationModal>
          <ConfirmationModal
            isOpen={confirmUnbind !== null}
            title="Bindung an die Anmeldung lösen?"
            icon={<Unplug className="h-5 w-5" aria-hidden="true" />}
            confirmText="Bindung lösen"
            confirmVariant="warning"
            confirmTooltip="Löst die Bindung sofort. Die Anmeldung bleibt an der Schule."
            isConfirmLoading={unbinding}
            loadingText="Wird gelöst …"
            onClose={() => setConfirmUnbind(null)}
            onConfirm={() => void unbindEnrollment()}
          >
            <div className="space-y-3 text-sm text-gray-700">
              <p>
                Der Vertrag folgt dann nicht mehr den Buchungen der Anmeldung.
                Ändert die Schule eine Buchung, entsteht keine neue
                Vertragsversion mehr.
              </p>
              <p>
                Die Anmeldung und ihre Buchungen bleiben an der Schule. Braucht
                das Kind sie nicht, nimmt die Schule die Buchungen heraus.
                Versionen, die schon entstanden sind, bleiben.
              </p>
              <p>
                Danach kannst du die Verknüpfung mit der Kinderakte lösen, oder
                du bindest den Vertrag über „Anmeldungen nachtragen“ wieder.
                Eltern bekommen keine Nachricht.
              </p>
            </div>
          </ConfirmationModal>
          <ConfirmDeleteModal
            isOpen={confirmDiscard}
            title="Entwurf verwerfen?"
            description={
              contract
                ? `Der Entwurf für ${childName(contract)} wird gelöscht. Die Anmeldung bleibt; du kannst danach einen neuen Entwurf erstellen.`
                : ""
            }
            gate={{ mode: "twoStep" }}
            confirmLabel="Entwurf verwerfen"
            loading={discarding}
            error={discardErrors.error}
            onConfirm={discard}
            onClose={() => setConfirmDiscard(false)}
          />
        </>
      }
    >
      {contract ? (
        <ContractDetailTabsProvider openTab={openTab}>
          <LoadErrorAlert error={afterSend.error} />
          <StatusNotice contract={contract} />
          {planned ? (
            <Alert
              type="info"
              message={plannedVersionText(planned)}
              action={
                <ContractSectionJump
                  targetId={CONTRACT_VERSIONS_SECTION_ID}
                  tooltip="Springt zu den Versionen und zeigt, was sich ändert."
                >
                  Zu den Versionen
                </ContractSectionJump>
              }
            />
          ) : null}
          {activeTab === "vertrag" ? (
            <>
              <SectionCard
                title="Vertragsangaben"
                description={
                  contract.concluded
                    ? "So steht es im abgeschlossenen Vertrag."
                    : contract.documentFrozen
                      ? "So steht es im versendeten Vertrag."
                      : "So steht es im Vertrag, wenn du ihn sendest."
                }
              >
                <DataGrid>
                  {contract.concluded ? (
                    <DataField label="Abgeschlossen">
                      {formatConclusion(contract.concluded)}
                    </DataField>
                  ) : null}
                  <DataField label="Kind">{childName(contract)}</DataField>
                  <DataField label="Vertrag Nr.">{contract.id}</DataField>
                  <DataField label="Geboren am">
                    {contract.version.childBirthDate
                      ? formatDate(contract.version.childBirthDate)
                      : "–"}
                  </DataField>
                  <DataField label="Betreuungsort">
                    {contract.version.schoolName}
                    {contract.version.phaseName ? (
                      <span className="block text-sm font-normal text-gray-500">
                        {contract.version.phaseName}
                      </span>
                    ) : null}
                  </DataField>
                  <DataField label="Beginn">
                    {formatDate(contract.version.effectiveFrom)}
                  </DataField>
                  <DataField label="Laufzeit">{contract.termText}</DataField>
                  <DataField label="Beitrag im Monat">
                    {contract.feeText}
                  </DataField>
                  {contract.imported ? (
                    <DataField label="Kinderakte">
                      <ChildRecordValue
                        studentId={contract.studentId}
                        onLink={() => setLinkingChild(true)}
                      />
                    </DataField>
                  ) : null}
                  {contract.imported && contract.followsBookings ? (
                    <DataField label="Anmeldung">
                      <span className="flex flex-col items-start gap-1.5">
                        <StatusBadge
                          tone="green"
                          label="Anmeldung nachgetragen"
                        />
                        <span className="text-sm font-normal text-gray-600">
                          Der Vertrag folgt jetzt den Buchungen der Anmeldung an
                          der Schule.
                        </span>
                      </span>
                    </DataField>
                  ) : null}
                </DataGrid>
              </SectionCard>
              <SectionCard
                concept={careTimesConcept}
                title="Gebuchte Betreuung"
                description={
                  contract.versions.length > 1
                    ? `Je Wochentag das Modul und bis wann das Kind betreut wird. So gilt es in Version ${contract.version.number}.`
                    : "Je Wochentag das Modul und bis wann das Kind betreut wird."
                }
              >
                <DataGrid>
                  {serviceDays(contract.version.services).map((day) => (
                    <DataField key={day.weekday} label={day.label}>
                      {day.services.length === 0 ? (
                        <span className="font-normal text-gray-500">
                          Keine Betreuung
                        </span>
                      ) : (
                        day.services.map((service) => (
                          <span key={service.careOfferingId} className="block">
                            {formatService(service)}
                          </span>
                        ))
                      )}
                    </DataField>
                  ))}
                </DataGrid>
              </SectionCard>
              <SectionCard concept={parentsConcept} title="Eltern">
                {contract.parties.length > 1 ? (
                  <DataGrid>
                    <DataField label="Vertrag mit" fullWidth>
                      <ContractPartyList parties={contract.parties} />
                    </DataField>
                  </DataGrid>
                ) : party ? (
                  <DataGrid>
                    {/* „Vertragspartner“ names the Träger's side on this
                        page; the family's side is named by what it is. */}
                    <DataField label="Vertrag mit">
                      {`${party.firstName} ${party.lastName}`.trim()}
                    </DataField>
                    <DataField label="E-Mail bei Vertragserstellung">
                      <span className="wrap-anywhere">
                        {party.email || "Keine E-Mail-Adresse"}
                      </span>
                    </DataField>
                    <DataField label="Elternkonto bei Vertragserstellung">
                      {party.hasAccount
                        ? "Konto verknüpft"
                        : "Kein Konto verknüpft"}
                    </DataField>
                  </DataGrid>
                ) : (
                  <p className="text-sm text-gray-600">
                    Im Vertrag steht kein Elternteil.
                  </p>
                )}
              </SectionCard>
              {contract.corrections.length > 0 ? (
                <CareContractCorrectionsCard
                  corrections={contract.corrections}
                />
              ) : null}
              {/* How the family pays is set here before the first invoice
                  (#7770); a mandate alone does not choose the debit. Also
                  for an imported contract without a party: it is a family
                  of its own. Not on a draft, which can be discarded with
                  what hangs on it, and not on a contract that is over: the
                  family's running contract carries it, and the retention
                  moves it to the family's next contract (#7862). Payment and
                  mandate belong to Elternbeiträge und Abrechnung: without
                  that module the contract shows neither (#6052). */}
              {!billingBooked ||
              isDraft ||
              contract.status === "beendet" ||
              contract.status === "widerrufen" ||
              (contract.endsOn && contract.endsOn < today) ? null : (
                <FamilyBillingStatusCard contractId={contract.id} />
              )}
              {/* A mandate hangs on its contract; discarding a draft
                  would take it along, so a draft gets none (#7862). */}
              {billingBooked && party?.email && !isDraft ? (
                <SepaMandateStatusCard contractId={contract.id} />
              ) : null}
            </>
          ) : null}
          {activeTab === "versand" ? (
            <>
              <CareContractSignatureCard
                contract={contract}
                onChanged={afterCardWrite}
              />
              <SectionCard
                id={CONTRACT_DELIVERY_SECTION_ID}
                title="Versand"
                actions={
                  resendInCard || refreshInCard ? (
                    <>
                      {refreshInCard ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="md"
                          isLoading={refreshing}
                          loadingText="Wird aktualisiert …"
                          tooltip="Holt den neuesten Stand der Mails an die Eltern."
                          onClick={() => void refreshDelivery()}
                        >
                          <RotateCw
                            className="mr-1.5 h-4 w-4"
                            aria-hidden="true"
                          />
                          Versand aktualisieren
                        </Button>
                      ) : null}
                      {resendInCard ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="md"
                          disabled={sendBlocked}
                          isLoading={sending}
                          loadingText="Wird gesendet …"
                          tooltip="moto fragt vorher nach, dann geht der Vertrag noch einmal an die Eltern."
                          disabledReason={sendBlockedReason}
                          onClick={() => setConfirmingSend(true)}
                        >
                          <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Erneut senden
                        </Button>
                      ) : null}
                    </>
                  ) : undefined
                }
                description={
                  contract.mailings.length > 0
                    ? undefined
                    : handedOverOnPaper(contract)
                      ? "Auf Papier übergeben, nicht per Mail."
                      : "Noch nicht gesendet."
                }
              >
                {contract.mailings.length > 0 ? (
                  <ol className="space-y-3">
                    {contract.mailings.map((mailing) => (
                      // The state sits beside the time; the address gets
                      // the full width of the card, so it rarely breaks.
                      <li key={mailing.sentAt} className="min-w-0 text-sm">
                        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <span className="font-medium text-gray-900">
                            {formatBerlinDate(mailing.sentAt)},{" "}
                            {formatBerlinTime(mailing.sentAt)} Uhr
                          </span>
                          <StatusBadge
                            label={contractMailBadge(mailing).label}
                            tone={contractMailBadge(mailing).tone}
                          />
                        </span>
                        <span className="mt-0.5 block text-gray-500">
                          an <EmailText email={mailing.recipient} />
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {!isDraft &&
                canSend &&
                lastMail?.state === "failed" &&
                lastMail.sendBlock !== "stopped" ? (
                  <form
                    ref={recipientForm}
                    noValidate
                    className="mt-5 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void resendToAddress();
                    }}
                  >
                    <FormErrorAlert message={recipientErrors.error} />
                    <p className="text-sm text-gray-600">
                      Du kannst eine andere Versandadresse verwenden. Das PDF
                      bleibt gleich. Die Vertragspartei und die bisherigen
                      Versanddaten bleiben erhalten.
                    </p>
                    <Input
                      controlSize="compact"
                      name="recipient_email"
                      type="email"
                      label="Neue Versandadresse"
                      autoComplete="off"
                      maxLength={320}
                      value={recipientEmail}
                      error={recipientErrors.fieldError("recipient_email")}
                      onChange={(event) =>
                        setRecipientEmail(event.target.value)
                      }
                      disabled={sending || refreshing}
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      disabled={refreshing}
                      isLoading={sending}
                      loadingText="Wird gesendet …"
                      tooltip="Schickt den Vertrag sofort an die neue Adresse."
                    >
                      An diese Adresse senden
                    </Button>
                  </form>
                ) : null}
              </SectionCard>
              {contract.status === "aktiv" ? (
                <CareContractChangeCard
                  contractId={contract.id}
                  onDecided={() => void afterCardWrite()}
                />
              ) : null}
            </>
          ) : null}
          {activeTab === "kuendigung" ? (
            <>
              <SectionCard title="Kündigung und Satzung">
                <DataGrid>
                  <DataField label="Kündigung">{contract.noticeText}</DataField>
                  <DataField label="Vertragspartner">
                    {contract.version.terms.contractPartner ||
                      "Der Träger selbst"}
                  </DataField>
                  <DataField label="Sonderkündigung" fullWidth>
                    {contract.version.terms.specialTermination ? (
                      <>
                        Zum Halbjahr: 31. Januar oder 31. Juli
                        <span className="block text-sm font-normal text-gray-500">
                          {contract.version.terms.specialTerminationNote}
                        </span>
                      </>
                    ) : (
                      "Nicht vorgesehen"
                    )}
                  </DataField>
                  <DataField label="Satzung" fullWidth>
                    {contract.version.terms.statuteRequired ? (
                      <StatuteValue contract={contract} />
                    ) : (
                      "Keine Satzungsbestätigung"
                    )}
                  </DataField>
                </DataGrid>
              </SectionCard>
              {contract.concluded ? (
                <CareContractNoticeCard
                  contractId={contract.id}
                  status={contract.status}
                  concludedAt={knownConclusionAt(contract.concluded)}
                  onChanged={() => void afterCardWrite()}
                />
              ) : null}
            </>
          ) : null}
          {activeTab === "versionen" ? (
            <>
              {showVersions ? (
                <CareContractVersions
                  contractId={contract.id}
                  versions={contract.versions}
                  end={{
                    withdrawn: contract.status === "widerrufen",
                    endsOn:
                      contract.status === "gekuendigt" ? contract.endsOn : null,
                  }}
                />
              ) : null}
              <SectionCard
                title={
                  contract.documentFrozen ? "PDF für die Eltern" : "Vorschau"
                }
                description={
                  contract.documentFrozen
                    ? "Dieses PDF gehört zum Versand. Es ändert sich nicht mehr."
                    : "So sieht der Vertrag mit deinem Briefkopf aus."
                }
              >
                <PdfPreview
                  url={pdfUrl}
                  title={`Vertrag von ${childName(contract)}`}
                />
              </SectionCard>
            </>
          ) : null}
        </ContractDetailTabsProvider>
      ) : null}
    </TenantPage>
  );
}

type ContractMailing = CareContractDetail["mailings"][number];

// The same words as the Abrechnung's letters: only a delivery report reads as
// delivered, and an outcome outranks the plain state of the mail.
function contractMailBadge(mailing: ContractMailing): {
  readonly label: string;
  readonly tone: StatusBadgeTone;
} {
  const copy =
    mailing.sendBlock === "provider"
      ? mailStatusCopy("provider_blocked", "", false, "active")
      : mailing.sendBlock === "provider_unknown"
        ? mailStatusCopy(mailing.outcome, "", false, "unreadable")
        : mailing.state === "queued" || mailing.outcome === "accepted"
          ? null
          : mailStatusCopy(mailing.outcome);
  return (
    copy ?? {
      label: MAIL_STATE_LABELS[mailing.state],
      tone: MAIL_STATE_TONES[mailing.state],
    }
  );
}

// Why „Vertrag senden“ / „Erneut senden“ is blocked, short enough for the
// bubble; the hold notice on the page gives the details (#6747).
function contractSendBlockedReason(
  mailing: ContractMailing,
  isDraft: boolean,
): string | undefined {
  if (mailing.state === "queued")
    return "Die letzte Mail wartet noch auf den Versand.";
  if (isDraft) return undefined;
  switch (mailing.sendBlock) {
    case "stopped":
      return "Die Schule hat Mails an diese Person gestoppt, kläre das mit ihr.";
    case "address":
    case "provider":
      return "Die Adresse ist gesperrt, sende unter „Versand“ an eine andere.";
    case "provider_unknown":
      return "Die Sperre der Adresse lässt sich gerade nicht prüfen, bitte später versuchen.";
    case "delayed":
      return "Die letzte Mail kommt verspätet noch an, neu gesendet käme sie doppelt.";
    default:
      return undefined;
  }
}

// The reason and the next step as they are now. "Prüfen Sie die Adresse" only
// fits a mail that came back; a stop or a block has another way out.
const OTHER_ADDRESS_HINT =
  "Unter „Versand“ kannst du eine andere Adresse verwenden.";

function contractHoldNotice(mailing: ContractMailing): string | null {
  const other = OTHER_ADDRESS_HINT;
  switch (mailing.sendBlock) {
    case "stopped":
      return "Die Schule hat die Mails an diese Person gestoppt. Kläre das mit der Schule, oder gib den Vertrag anders weiter.";
    case "address":
      return `Die Adresse ${mailing.recipient} ist bei einer deiner Schulen gesperrt. Die Schule kann sie prüfen. ${other}`;
    case "provider":
      return `Die Adresse ${mailing.recipient} ist gesperrt. Der moto-Support muss das klären. ${other}`;
    case "provider_unknown":
      return "Ob diese Adresse gesperrt ist, lässt sich gerade nicht prüfen. Bitte versuche es später noch einmal.";
    case "delayed":
      return "Die Mail kommt später an, es wird weiter versucht. Bitte sende sie nicht noch einmal, sonst kommt sie doppelt an.";
  }
  switch (mailing.outcome) {
    case "unsubscribed":
      return `${mailing.recipient} hat sich von den Mails abgemeldet. Sprich die Person direkt an. ${other}`;
    case "complained":
      return `${mailing.recipient} hat eine Mail als unerwünscht gemeldet. Sprich die Person direkt an. ${other}`;
    case "held_by_stop":
    case "blocked":
    case "provider_blocked":
      return "Die Mail ging damals nicht raus. Die Sperre besteht nicht mehr. Du kannst neu senden.";
    case "overdue":
      return "Die Mail ist seit Tagen verzögert. Du kannst sie noch einmal senden.";
    default:
      return null;
  }
}

/** Leads a notice about the mail to the card „Versand“ (#7054). */
function DeliveryJump() {
  return (
    <ContractSectionJump
      targetId={CONTRACT_DELIVERY_SECTION_ID}
      tooltip="Springt zu den Mails an die Eltern."
    >
      Zum Versand
    </ContractSectionJump>
  );
}

function StatusNotice({
  contract,
}: Readonly<{ contract: CareContractDetail }>) {
  const last = contract.mailings[0];
  if (contract.status === "entwurf") {
    return (
      <Alert
        type="info"
        message="Entwurf. Die Eltern sehen den Vertrag erst, wenn du ihn sendest. Prüfe die gebuchte Betreuung, den Beginn und den Beitrag."
      />
    );
  }
  // A signed contract shows its signature card; the mail no longer needs a
  // notice unless it failed (#4679).
  if (contract.signature && last?.state !== "failed") return null;
  const held = last ? contractHoldNotice(last) : null;
  if (held) {
    return (
      <Alert
        type="warning"
        message={held}
        // The blocked or refused address can be swapped under „Versand“.
        action={
          held.includes(OTHER_ADDRESS_HINT) ? <DeliveryJump /> : undefined
        }
      />
    );
  }
  if (last?.state === "failed") {
    return (
      <Alert
        type="warning"
        message={`Die Mail an ${last.recipient} kam nicht an. Prüfe die Adresse. Unter „Versand“ kannst du eine andere Adresse verwenden.`}
        action={<DeliveryJump />}
      />
    );
  }
  if (contract.status === "gekuendigt" && contract.endsOn) {
    return (
      <Alert
        type="info"
        message={`Gekündigt. Der Vertrag endet am ${formatDate(contract.endsOn)}. Bis dahin gilt die gebuchte Betreuung. Die Bestätigung steht unter „Vertrag beenden“.`}
        action={contract.concluded ? <NoticeCardJump /> : undefined}
      />
    );
  }
  if (contract.status === "gekuendigt") {
    return (
      <Alert
        type="warning"
        message="Außerordentlich gekündigt. Prüfe den Grund der Eltern und lege unter „Vertrag beenden“ fest, wann der Vertrag endet. Bis dahin gilt die gebuchte Betreuung."
        action={contract.concluded ? <NoticeCardJump /> : undefined}
      />
    );
  }
  if (contract.status === "widerrufen") {
    return (
      <Alert
        type="info"
        message="Widerrufen. Der Vertrag ist vom ersten Tag an aufgehoben und gilt an keinem Tag."
      />
    );
  }
  if (contract.concluded?.method === "mit_anmeldung") {
    return (
      <Alert
        type="success"
        // The app shows the contract only with a linked parent account. Once
        // the mail is out, „Versand“ names it: the banner says only the app.
        message={`Der Vertrag gilt seit der Annahme der Anmeldung am ${formatBerlinDate(contract.concluded.at)}. ${
          last?.state === "sent"
            ? contract.parties.some((party) => party.hasAccount)
              ? "Die Eltern sehen ihn auch in der Eltern-App."
              : "In der Eltern-App sehen die Eltern ihn, sobald sie ein Konto verknüpft haben."
            : contract.parties.some((party) => party.hasAccount)
              ? "Die Eltern bekommen ihn per E-Mail und in der Eltern-App."
              : "Die Eltern bekommen ihn per E-Mail. In der Eltern-App sehen sie ihn, sobald sie ein Konto verknüpft haben."
        }`}
      />
    );
  }
  if (last?.state === "queued") {
    return (
      <Alert
        type="info"
        message="Die Mail wartet auf den Versand. Mit „Versand aktualisieren“ unter „Versand“ prüfst du den Stand."
        action={<DeliveryJump />}
      />
    );
  }
  if (last?.state === "unknown") {
    return (
      <Alert
        type="warning"
        message="Das Ergebnis des Mail-Versands ist unbekannt. Mit „Versand aktualisieren“ unter „Versand“ prüfst du den Stand."
        action={<DeliveryJump />}
      />
    );
  }
  if (last?.state === "sent") {
    return (
      <Alert
        type="success"
        message={`Versendet am ${formatBerlinDate(last.sentAt)}. Die Mail ging an ${last.recipient}.`}
      />
    );
  }
  return null;
}

/**
 * Several parties of one contract (#7767), each with its address and
 * whether a parents account is linked. One party keeps its own fields.
 */
function ContractPartyList({
  parties,
}: Readonly<{ parties: CareContractDetail["parties"] }>) {
  return (
    <ul className="divide-y divide-gray-100">
      {parties.map((entry, n) => (
        <li
          // Two parties may share a name; the place keeps them apart.
          key={`${n}-${entry.firstName}-${entry.lastName}`}
          className="py-2 first:pt-0 last:pb-0"
        >
          <span className="block">
            {`${entry.firstName} ${entry.lastName}`.trim() || "–"}
          </span>
          <span className="block text-sm font-normal text-gray-500">
            <span className="wrap-anywhere">
              {entry.email || "Keine E-Mail-Adresse"}
            </span>
            {` · ${entry.hasAccount ? "Konto verknüpft" : "Kein Konto verknüpft"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Ob ein importierter Vertrag mit der Kinderakte verknüpft ist (#7760), und
 * was ohne Verknüpfung fehlt.
 */
function ChildRecordValue({
  studentId,
  onLink,
}: Readonly<{ studentId: string | null; onLink: () => void }>) {
  if (studentId) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="green" label="Verknüpft" />
        <span className="tabular-nums">Nr. {studentId}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1.5">
      <StatusBadge tone="warning" label="Nicht verknüpft" />
      <span className="text-sm font-normal text-gray-600">
        Ohne Kinderakte fehlen der Soll-Ist-Vergleich, die genaue Zuordnung des
        Essens und Rechnungen im Elternpostfach.
      </span>
      <Button
        type="button"
        variant="outline"
        size="compact"
        className="mt-1"
        onClick={onLink}
        tooltip="Zeigt Vertrag und Kinderakte zum Vergleich, dann verknüpfst du."
      >
        <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Mit Kinderakte verknüpfen
      </Button>
    </span>
  );
}

function StatuteValue({
  contract,
}: Readonly<{ contract: CareContractDetail }>) {
  const { statuteTitle, statuteUrl } = contract.version.terms;
  return (
    <span>
      Die Eltern erkennen die „{statuteTitle}“ an.
      {statuteUrl ? (
        <>
          {" "}
          <a
            href={statuteUrl}
            target="_blank"
            rel="noreferrer"
            className="text-moto-blue-strong underline"
          >
            Satzung öffnen
          </a>
        </>
      ) : null}
    </span>
  );
}
