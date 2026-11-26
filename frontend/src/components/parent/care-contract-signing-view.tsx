"use client";

// Einen Betreuungsvertrag lesen und unterschreiben (#4679). Dieselbe Ansicht
// dient dem einmaligen Link aus der Mail (ohne Konto) und der Eltern-App
// unter „Dokumente“: erst der Vertrag mit der gebuchten Betreuung und dem
// PDF, dann die Widerrufsbelehrung, dann die Unterschrift. Ein
// unterschriebener Vertrag zeigt nur noch die Bestätigung.
//
// Wartet eine geänderte Fassung auf die Unterschrift (#4816), zeigt die
// Ansicht statt der gebuchten Betreuung, was sich je Wochentag ändert, und
// sagt, dass der Vertrag bis zur Unterschrift wie bisher gilt.

import { CheckCircle2, FileText, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSignaturePadLabels } from "~/components/parent/news/signature-pad-labels";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConsentCheckbox } from "~/components/ui/consent-checkbox";
import { DataField, DataGrid } from "~/components/ui/data-field";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { PdfPreview, useObjectUrl } from "~/components/ui/pdf-preview";
import { SectionCard } from "~/components/ui/section-card";
import { ContractChangeOverview } from "./care-contract-change-overview";
import { ParentFamilyChildrenCard } from "./parent-family-children-card";
import { SignaturePad } from "~/components/ui/signature-pad";
import { useStepFocus } from "~/components/ui/use-step-focus";
import {
  CardGridSkeleton,
  SkeletonRegion,
} from "~/components/ui/page-skeletons";
import { useApiFormError, useApiLoadError } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import {
  fetchSigningView,
  signContract,
  fetchSigningDocument,
  signingDocumentUrl,
  type SigningService,
  type SigningSource,
  type SigningView,
} from "~/lib/care-contract-signing-api";
import { contractWeekdays } from "~/lib/care-contract-weekdays";
import { careContractsConcept } from "~/lib/concepts/careContracts";
import {
  formatBerlinDate,
  formatBerlinTime,
  formatDate,
} from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { parentInboxKeys } from "~/lib/swr/parent-inbox-keys";
import type { SignatureValue } from "~/lib/signature";

const logger = createLogger({ component: "ContractSigningView" });

const NOTICE_FIELD = "withdrawal_notice_acknowledged";
const SIGNATURE_FIELD = "contract-signature";

function isLinkGone(err: unknown): boolean {
  return (
    err instanceof ApiError && err.code === "care_contract.signing_link_invalid"
  );
}

function serviceDays(services: readonly SigningService[]) {
  return contractWeekdays(services).map((weekday) => ({
    weekday,
    services: services.filter((service) => service.weekday === weekday),
  }));
}

export function ContractSigningView({
  source: initialSource,
}: Readonly<{ source: SigningSource }>) {
  const t = useTranslations("careContractSigning");
  // The page names one contract for its whole life.
  const [source] = useState(initialSource);
  const [view, setView] = useState<SigningView | null>(null);
  const [gone, setGone] = useState(false);
  // The signed view no longer names the version before; the confirmation
  // still says that a changed version was signed.
  const [signedChange, setSignedChange] = useState(false);
  const invalidateFamily = useInvalidateFamily();
  const loadError = useApiLoadError();
  const { show: showLoadError, clear: clearLoadError } = loadError;
  const signed = view ? !view.awaitsSignature : null;
  // Signing replaces the form with the confirmation (#7111): its heading
  // takes the focus from the send button that is gone. Loading is no step.
  const stepRef = useStepFocus<HTMLDivElement>(
    signed === null ? null : signed ? "signed" : "sign",
  );

  const load = useCallback(async () => {
    try {
      setView(await fetchSigningView(source));
      clearLoadError();
    } catch (err) {
      if (isLinkGone(err)) {
        setGone(true);
        return;
      }
      logger.error("care_contract_signing_load_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showLoadError(err, {
        object: t("errorObject"),
        retry: () => void load(),
      });
    }
  }, [source, clearLoadError, showLoadError, t]);

  // oxlint-disable-next-line swr/no-effect-load -- one path serves the sessionless mail link and the inbox; the link has no session for useSWRAuth
  useEffect(() => {
    void load();
  }, [load]);

  if (gone) {
    return (
      <SectionCard concept={careContractsConcept} title={t("invalidTitle")}>
        <p className="text-sm text-gray-700">{t("invalidText")}</p>
      </SectionCard>
    );
  }
  if (loadError.error) return <LoadErrorAlert error={loadError.error} />;
  if (!view)
    return (
      <SkeletonRegion label={t("loading")}>
        <CardGridSkeleton cards={3} className="grid grid-cols-1 gap-5" />
      </SkeletonRegion>
    );
  if (signed) {
    // The mail link closes with the signature (#4679); the number stays
    // changeable in the parents portal.
    return (
      <div ref={stepRef} className="space-y-5">
        <SignedConfirmation view={view} change={signedChange} />
        {source.kind === "inbox" ? (
          <ParentFamilyChildrenCard source={source} />
        ) : null}
      </div>
    );
  }
  return (
    <div ref={stepRef} className="space-y-5">
      <ContractFacts view={view} />
      <ParentFamilyChildrenCard source={source} />
      {view.previous ? (
        <ContractChangeOverview
          previous={view.previous}
          services={view.services}
        />
      ) : (
        <BookedCare view={view} />
      )}
      <ContractDocument source={source} view={view} />
      <WithdrawalNotice view={view} />
      <SignForm
        source={source}
        view={view}
        onSigned={(next) => {
          setSignedChange(view.previous !== null);
          setView(next);
          // Signed in the parents portal: the documents inbox shows it.
          if (source.kind === "inbox")
            void invalidateFamily(parentInboxKeys.documents());
        }}
      />
    </div>
  );
}

function ContractFacts({ view }: Readonly<{ view: SigningView }>) {
  const t = useTranslations("careContractSigning");
  const locale = useLocale();
  const euro = (cents: number | null) =>
    cents === null
      ? t("feeByRules")
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency: "EUR",
        }).format(cents / 100);
  const end = (day: string | null) =>
    day ? formatDate(day, false, locale) : t("openEnded");
  const previous = view.previous;
  const from = formatDate(view.effectiveFrom, false, locale);
  // A changed version of a contract in force, or of one not signed yet.
  const intro = previous
    ? view.status === "aktiv"
      ? t("changeIntro", { date: from })
      : t("changeIntroUnsigned")
    : t("intro");
  return (
    <SectionCard
      concept={careContractsConcept}
      kicker={t("kicker", { traeger: view.traegerName })}
      title={t(previous ? "changeTitle" : "title", { child: view.childName })}
      description={intro}
    >
      <DataGrid>
        <DataField label={t("child")}>{view.childName}</DataField>
        <DataField label={t("place")}>
          {view.schoolName}
          {view.phaseName ? (
            <span className="block text-sm font-normal text-gray-500">
              {view.phaseName}
            </span>
          ) : null}
        </DataField>
        <DataField label={t(previous ? "validFrom" : "startsOn")}>
          {from}
        </DataField>
        <DataField label={t("endsOn")}>
          <ChangedValue
            before={previous ? end(previous.endsOn) : null}
            after={end(view.endsOn)}
          />
        </DataField>
        <DataField label={t("fee")}>
          <ChangedValue
            before={previous ? euro(previous.priceCents) : null}
            after={euro(view.priceCents)}
          />
        </DataField>
        <DataField label={t("party")}>{view.partyName || "–"}</DataField>
      </DataGrid>
    </SectionCard>
  );
}

/**
 * A value of the new version; when the version before had another one, that
 * one stands struck through in front of it.
 */
function ChangedValue({
  before,
  after,
}: Readonly<{ before: string | null; after: string }>) {
  const t = useTranslations("careContractSigning");
  if (before === null || before === after) return <>{after}</>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className="font-normal text-gray-500 line-through decoration-gray-400">
        <span className="sr-only">{t("before")}: </span>
        {before}
      </span>
      <span>
        <span className="sr-only">{t("after")}: </span>
        {after}
      </span>
    </span>
  );
}

function BookedCare({ view }: Readonly<{ view: SigningView }>) {
  const t = useTranslations("careContractSigning");
  const locale = useLocale();
  return (
    <SectionCard title={t("bookedTitle")} description={t("bookedDescription")}>
      <ul className="divide-y divide-gray-100">
        {serviceDays(view.services).map((day) => (
          <li
            key={day.weekday}
            className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <span className="w-28 shrink-0 text-sm font-semibold text-gray-900">
              {t(`weekdays.${day.weekday}`)}
            </span>
            {day.services.length === 0 ? (
              <span className="text-sm text-gray-500">{t("noCare")}</span>
            ) : (
              <span className="flex min-w-0 flex-col gap-0.5 text-sm text-gray-700">
                {day.services.map((service) => (
                  <span key={`${service.moduleName}-${service.endsAt}`}>
                    <span className="font-medium text-gray-900">
                      {service.moduleName}
                    </span>
                    {service.endsAt
                      ? ` · ${t("until", { time: service.endsAt })}`
                      : null}
                    {service.lastDay
                      ? ` · ${t("bookedUntil", { date: formatDate(service.lastDay, false, locale) })}`
                      : null}
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function ContractDocument({
  source,
  view,
}: Readonly<{ source: SigningSource; view: SigningView }>) {
  const t = useTranslations("careContractSigning");
  const [blob, setBlob] = useState<Blob | null>(null);
  const url = useObjectUrl(blob);
  const documentUrl = signingDocumentUrl(source);
  // The page passes a new source object on every render; the preview loads
  // again only when the contract changes.
  const link = source.kind === "link" ? source.link : null;
  const organizationId = source.kind === "inbox" ? source.organizationId : "";
  const contractId = source.kind === "inbox" ? source.contractId : "";

  // oxlint-disable-next-line swr/no-effect-load -- loads the PDF as a blob for an object URL preview, also for the sessionless mail link
  useEffect(() => {
    let cancelled = false;
    fetchSigningDocument(
      link === null
        ? { kind: "inbox", organizationId, contractId }
        : { kind: "link", link },
    )
      .then((loaded) => {
        if (!cancelled) setBlob(loaded);
      })
      .catch((err: unknown) => {
        // The preview is optional; „PDF öffnen“ still offers the file.
        logger.warn("care_contract_signing_preview_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [link, organizationId, contractId]);

  return (
    <SectionCard
      icon={FileText}
      title={t(view.previous ? "pdfTitleChange" : "pdfTitle")}
      description={t(view.previous ? "pdfDescriptionChange" : "pdfDescription")}
      action={
        <a
          href={url ?? documentUrl}
          target="_blank"
          rel="noreferrer"
          className="text-moto-blue-strong inline-flex items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline"
        >
          {t("openPdf")}
        </a>
      }
    >
      <PdfPreview url={url} title={t("pdfTitle")} className="max-h-[40rem]" />
      <p className="mt-3 text-xs break-all text-gray-500">
        {t("checksum")}:{" "}
        <span className="font-mono">{view.documentSha256}</span>
      </p>
    </SectionCard>
  );
}

function WithdrawalNotice({ view }: Readonly<{ view: SigningView }>) {
  const t = useTranslations("careContractSigning");
  return (
    <SectionCard
      icon={ShieldCheck}
      title={t("withdrawalTitle")}
      description={t(
        view.previous && view.status === "aktiv"
          ? "withdrawalDescriptionChange"
          : "withdrawalDescription",
      )}
    >
      <div className="space-y-3 text-sm leading-relaxed text-gray-700">
        {view.withdrawalNotice.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </SectionCard>
  );
}

function SignForm({
  source,
  view,
  onSigned,
}: Readonly<{
  source: SigningSource;
  view: SigningView;
  onSigned: (view: SigningView) => void;
}>) {
  const t = useTranslations("careContractSigning");
  const labels = useSignaturePadLabels();
  const formRef = useRef<HTMLFormElement>(null);
  const formError = useApiFormError(formRef);
  const [notice, setNotice] = useState(false);
  const [earlyStart, setEarlyStart] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const locale = useLocale();
  // A changed version of a contract in force takes effect with the
  // signature; any other signature concludes the contract.
  const change = view.previous !== null;
  const inForce = change && view.status === "aktiv";

  const submit = async () => {
    setSubmitted(true);
    formError.clear();
    if (!notice || !signature) {
      // The alert names the problem, the focus goes to the first missing
      // field (#7111); the hints at the fields stay as they are.
      formError.invalid(t("checkFields"), {
        ...(notice ? {} : { [NOTICE_FIELD]: t("noticeRequired") }),
        ...(signature ? {} : { [SIGNATURE_FIELD]: t("signatureRequired") }),
      });
      return;
    }
    setSaving(true);
    try {
      onSigned(
        await signContract(source, {
          signature,
          noticeAcknowledged: notice,
          earlyStart,
        }),
      );
    } catch (err) {
      logger.error("care_contract_signing_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void formError.show(err, { object: t("submitObject") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      concept={careContractsConcept}
      title={t(change ? "signTitleChange" : "signTitle")}
      description={
        inForce
          ? t("signDescriptionChange", {
              date: formatDate(view.effectiveFrom, false, locale),
            })
          : t("signDescription")
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormErrorAlert message={formError.error} />
        <ConsentCheckbox
          name={NOTICE_FIELD}
          required
          checked={notice}
          onChange={setNotice}
          label={t("noticeConfirm")}
          error={submitted && !notice ? t("noticeRequired") : undefined}
        />
        <ConsentCheckbox
          name="early_start_requested"
          checked={earlyStart}
          onChange={setEarlyStart}
          label={t("earlyStart")}
          description={t("earlyStartHint")}
        />
        <SignaturePad
          id={SIGNATURE_FIELD}
          value={signature}
          onChange={setSignature}
          disabled={saving}
          signerNameHint={view.partyName}
          labels={labels}
          error={submitted && !signature ? t("signatureRequired") : null}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="success"
            size="lg"
            disabled={saving}
            tooltip={t(inForce ? "submitChangeTooltip" : "submitTooltip")}
            className="w-full sm:w-auto"
          >
            {saving ? t("submitting") : t(change ? "submitChange" : "submit")}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function SignedConfirmation({
  view,
  change,
}: Readonly<{ view: SigningView; change: boolean }>) {
  const t = useTranslations("careContractSigning");
  const locale = useLocale();
  const signature = view.signature;
  // The parents' own request counts as their agreement (#4816): nothing was
  // signed, so the page says why the version holds.
  const byRequest = signature?.method === "request";
  const title = !signature
    ? t("alreadyInForce")
    : byRequest
      ? t("requestTitle")
      : t(change ? "signedTitleChange" : "signedTitle");
  return (
    <SectionCard
      icon={CheckCircle2}
      kicker={t("kicker", { traeger: view.traegerName })}
      title={title}
    >
      <div className="space-y-4">
        {signature ? (
          <Alert
            type="success"
            message={
              byRequest
                ? t("signedByRequest", {
                    date: formatBerlinDate(signature.signedAt, locale),
                  })
                : `${t("signedBy", {
                    name: signature.signerName,
                    date: formatBerlinDate(signature.signedAt, locale),
                    time: formatBerlinTime(signature.signedAt, locale),
                  })} ${t("signedMail")}`
            }
          />
        ) : null}
        <DataGrid>
          <DataField label={t("child")}>{view.childName}</DataField>
          <DataField label={t("startsOn")}>
            {formatDate(view.effectiveFrom, false, locale)}
          </DataField>
          {signature?.withdrawalEndsOn ? (
            <DataField label={t("withdrawalTitle")} fullWidth>
              {t("withdrawalUntil", {
                date: formatDate(signature.withdrawalEndsOn, false, locale),
              })}
              {signature.earlyStartRequested ? (
                <span className="block text-sm font-normal text-gray-500">
                  {t("earlyStartChosen")}
                </span>
              ) : null}
            </DataField>
          ) : null}
        </DataGrid>
      </div>
    </SectionCard>
  );
}
