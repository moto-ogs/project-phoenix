"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { ParentSection } from "~/components/parent/shell/parent-section";
import { ParentSectionSkeleton } from "~/components/parent/parent-page";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { ConfirmationModal } from "~/components/ui/modal";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { useApiFormError } from "~/contexts/ToastContext";
import { PARENT_RESOURCE_OPTIONS } from "~/lib/hooks/use-parent-resources";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import { formatBerlinDate } from "~/lib/date-helpers";
import {
  getChildConsents,
  getChildRoomHistoryStop,
  grantChildPhotoConsent,
  resumeChildRoomHistory,
  stopChildRoomHistory,
  withdrawChildPhotoConsent,
} from "~/lib/parent-api";
import { confirmationsConcept } from "~/lib/concepts/confirmations";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

// Foto-Einwilligung widerrufen/erneut geben, Raumverlauf und Stimmung
// stoppen/wieder speichern (#3844).
type ConsentAction = "withdraw" | "grant" | "stop" | "resume";

const photoConsentCalls = {
  withdraw: withdrawChildPhotoConsent,
  grant: grantChildPhotoConsent,
};
const roomHistoryStopCalls = {
  stop: stopChildRoomHistory,
  resume: resumeChildRoomHistory,
};

// Die Zeile „Raumverlauf und Stimmung“ (#3844) kommt aus einer eigenen
// Leseroute: wenn der Träger den Stopp für Eltern freigegeben hat oder das
// Kind gestoppt ist.
function roomHistoryRow(
  stop: parentMeContract.ChildRoomHistoryStopResponse | undefined,
): parentMeContract.ChildConsentResponse | null {
  if (!stop?.offered) return null;
  return {
    key: "room_history",
    state: stop.stopped ? "stopped" : "recording",
    changed_at: stop.stopped_at,
    can_withdraw: stop.can_change && !stop.stopped,
    can_grant: stop.can_change && stop.stopped,
  };
}

// Texte je Aktion: Dialog, Erfolg und Fehlerobjekt.
const consentActionTexts: Record<
  ConsentAction,
  {
    title: string;
    body: string;
    confirm: string;
    loading: string;
    success: string;
    errorObject: string;
  }
> = {
  withdraw: {
    title: "confirmTitle",
    body: "confirmBody",
    confirm: "confirmButton",
    loading: "withdrawing",
    success: "success",
    errorObject: "errorObjectPhoto",
  },
  grant: {
    title: "grantConfirmTitle",
    body: "grantConfirmBody",
    confirm: "grantConfirmButton",
    loading: "granting",
    success: "grantSuccess",
    errorObject: "errorObjectPhoto",
  },
  stop: {
    title: "roomHistoryStopTitle",
    body: "roomHistoryStopBody",
    confirm: "roomHistoryStopButton",
    loading: "roomHistoryStopping",
    success: "roomHistoryStopSuccess",
    errorObject: "errorObjectRoomHistory",
  },
  resume: {
    title: "roomHistoryResumeTitle",
    body: "roomHistoryResumeBody",
    confirm: "roomHistoryResumeButton",
    loading: "roomHistoryResuming",
    success: "roomHistoryResumeSuccess",
    errorObject: "errorObjectRoomHistory",
  },
};

export function ChildConsentsSection({
  studentId,
}: Readonly<{ studentId: string }>) {
  const t = useCareTermTranslations("parentChild.consents");
  const locale = useLocale();
  const resource = useSWRAuth(
    parentKeys.consents(studentId),
    () => getChildConsents(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  const stopResource = useSWRAuth(
    parentKeys.roomHistoryStop(studentId),
    () => getChildRoomHistoryStop(studentId),
    PARENT_RESOURCE_OPTIONS,
  );
  const consents = resource.data ?? null;
  const [pendingAction, setPendingAction] = useState<ConsentAction | null>(
    null,
  );
  const [submittingAction, setSubmittingAction] = useState(false);
  const [successfulAction, setSuccessfulAction] =
    useState<ConsentAction | null>(null);
  // Der Fehler einer Änderung steht im offenen Dialog: ein Toast läge
  // unsichtbar unter ihm.
  const actionErrors = useApiFormError();
  const latestConfirmRef = useRef<() => void>(() => undefined);

  // Nur die Einwilligungen tragen die Ladefehler-Anzeige. Scheitert das Lesen
  // des Stopps, fehlt bloß dessen Zeile: Die Foto-Einwilligung bleibt
  // sichtbar und änderbar, der nächste Abruf versucht es erneut.
  const { error: loadError, failure: loadFailed } = useSwrResourceLoadError(
    [resource],
    t("errorObjectList"),
    () => void resource.mutate(),
  );

  async function confirmAction() {
    const action = pendingAction;
    if (!action) return;

    setSubmittingAction(true);
    actionErrors.clear();
    try {
      if (action === "stop" || action === "resume") {
        const updatedStop = await roomHistoryStopCalls[action](studentId);
        await stopResource.mutate(updatedStop, { revalidate: false });
      } else {
        const updatedConsents = await photoConsentCalls[action](studentId);
        await resource.mutate(updatedConsents, { revalidate: false });
      }
      setPendingAction(null);
      setSuccessfulAction(action);
    } catch (err) {
      void actionErrors.show(err, {
        object: t(consentActionTexts[action].errorObject),
        retry: () => latestConfirmRef.current(),
      });
    } finally {
      setSubmittingAction(false);
    }
  }

  useLayoutEffect(() => {
    latestConfirmRef.current = () => void confirmAction();
  });

  if (consents === null && !loadFailed) {
    return <ParentSectionSkeleton rows={4} />;
  }
  if (loadFailed) return <LoadErrorAlert error={loadError} />;

  const roomHistory = roomHistoryRow(stopResource.data);
  const visibleConsents = [
    ...(consents?.filter((consent) => consent.state !== "not_recorded") ?? []),
    ...(roomHistory ? [roomHistory] : []),
  ];
  if (visibleConsents.length === 0) return null;

  const canChangePhotoConsent = visibleConsents.some(
    (consent) =>
      consent.key === "photo" && (consent.can_withdraw || consent.can_grant),
  );
  // Ohne Recht zur Foto-Einwilligung bleibt der Widerruf über die OGS
  // (#6650): Die Zeile sagt, wer ihn einträgt, statt eine Sackgasse zu zeigen.
  const photoGrantedElsewhere = visibleConsents.some(
    (consent) =>
      consent.key === "photo" &&
      consent.state === "granted" &&
      !consent.can_withdraw,
  );
  let description = t("description");
  if (canChangePhotoConsent) {
    description = `${description} ${t("photoDescription")}`;
  } else if (photoGrantedElsewhere) {
    description = `${description} ${t("photoViaCareDescription")}`;
  }
  // Raumverlauf und Stimmung (#3844): Der Hinweis zum Stoppen steht nur,
  // solange Eltern hier stoppen können. Ein Stopp, den sie nicht aufheben
  // können (fehlendes Recht oder vom Träger abgeschaltet), nennt, wer ihn
  // aufhebt.
  if (roomHistory?.can_withdraw) {
    description = `${description} ${t("roomHistoryDescription")}`;
  } else if (roomHistory?.state === "stopped" && !roomHistory.can_grant) {
    description = `${description} ${t("roomHistoryViaCareDescription")}`;
  }
  const startAction = (action: ConsentAction) => {
    actionErrors.clear();
    setSuccessfulAction(null);
    setPendingAction(action);
  };
  const pendingTexts = consentActionTexts[pendingAction ?? "withdraw"];

  return (
    <>
      <ParentSection
        title={t("title")}
        description={description}
        concept={confirmationsConcept}
      >
        {successfulAction ? (
          <Alert
            type="success"
            message={t(consentActionTexts[successfulAction].success)}
          />
        ) : null}
        <ul className="divide-y divide-gray-100">
          {visibleConsents.map((consent) => (
            <li
              key={consent.key}
              className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {t(`items.${consent.key}`)}
                </p>
                {consent.changed_at ? (
                  <p className="mt-1 text-sm text-gray-600">
                    {t(`dates.${consent.state}`, {
                      date: formatBerlinDate(consent.changed_at, locale),
                    })}
                  </p>
                ) : null}
                {consent.key === "photo" &&
                consent.state === "granted" &&
                consent.can_withdraw ? (
                  <div>
                    <Button
                      type="button"
                      variant="ghost_danger"
                      size="compact"
                      className="mt-1"
                      aria-label={t("withdrawButton")}
                      tooltip={t("withdrawTooltip")}
                      onClick={() => startAction("withdraw")}
                    >
                      {t("withdrawButtonShort")}
                    </Button>
                  </div>
                ) : null}
                {consent.key === "photo" &&
                consent.state === "withdrawn" &&
                consent.can_grant ? (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      className="mt-1"
                      aria-label={t("grantButton")}
                      tooltip={t("grantTooltip")}
                      onClick={() => startAction("grant")}
                    >
                      {t("grantButtonShort")}
                    </Button>
                  </div>
                ) : null}
                {consent.key === "room_history" &&
                consent.state === "recording" &&
                consent.can_withdraw ? (
                  <div>
                    <Button
                      type="button"
                      variant="ghost_danger"
                      size="compact"
                      className="mt-1"
                      aria-label={t("roomHistoryStopAria")}
                      tooltip={t("roomHistoryStopTooltip")}
                      onClick={() => startAction("stop")}
                    >
                      {t("roomHistoryStopShort")}
                    </Button>
                  </div>
                ) : null}
                {consent.key === "room_history" &&
                consent.state === "stopped" &&
                consent.can_grant ? (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      className="mt-1"
                      aria-label={t("roomHistoryResumeAria")}
                      tooltip={t("roomHistoryResumeTooltip")}
                      onClick={() => startAction("resume")}
                    >
                      {t("roomHistoryResumeShort")}
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="flex items-start sm:items-end">
                <StatusBadge
                  label={t(`states.${consent.state}`)}
                  tone={stateTone(consent.state)}
                />
              </div>
            </li>
          ))}
        </ul>
      </ParentSection>
      <ConfirmationModal
        isOpen={pendingAction !== null}
        onClose={() => {
          actionErrors.clear();
          setPendingAction(null);
        }}
        onConfirm={() => void confirmAction()}
        title={t(pendingTexts.title)}
        confirmText={t(pendingTexts.confirm)}
        cancelText={t("cancel")}
        loadingText={t(pendingTexts.loading)}
        isConfirmLoading={submittingAction}
        isDismissDisabled={submittingAction}
        confirmVariant={
          pendingAction === "withdraw" || pendingAction === "stop"
            ? "danger"
            : "primary"
        }
        closeLabel={t("close")}
        backdropLabel={t("close")}
        mobileSheet
      >
        <FormErrorAlert message={actionErrors.error} className="mb-3" />
        <p>{t(pendingTexts.body)}</p>
        {/* #4721: Ein Widerruf gilt auch dort, wo das Kind in den Ferien als
            Gast betreut wird. Der Satz steht da, wo die Eltern entscheiden. */}
        {pendingAction === "withdraw" ? (
          <p className="mt-3">{t("confirmHolidayNote")}</p>
        ) : null}
      </ConfirmationModal>
    </>
  );
}

function stateTone(state: string): StatusBadgeTone {
  if (state === "granted" || state === "recording") return "green";
  if (state === "withdrawn" || state === "stopped") return "orange";
  return "gray";
}
