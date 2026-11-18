"use client";

/**
 * Lese-Ansicht einer Tages-Abholzeit-Anfrage, geöffnet aus dem Nachrichten-
 * Verlauf (#3135). Zeigt, was die Eltern für welchen Tag beantragt haben und
 * wie die OGS entschieden hat; auch nach Freigabe, Ablehnung oder Rücknahme.
 * Hier wird nichts entschieden: eine offene Anfrage verweist auf `Anfragen`.
 */

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { formErrorMessage } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  DataField,
  DataFieldSkeleton,
  DataGrid,
} from "~/components/ui/data-field";
import { InfoSection } from "~/components/ui/info-section";
import { DetailIcons, InfoText } from "~/components/ui/detail-modal-components";
import { Modal } from "~/components/ui/modal";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { HISTORY_STATUS_META } from "~/components/students/requests/request-copy";
import {
  fetchCareScheduleChangeRequest,
  type StaffCareRequestDetail,
} from "~/lib/care-request-review-api";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { formatChatDateTime, formatDate } from "~/lib/date-helpers";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useDiscardRefusedEntity } from "~/lib/swr/hooks";
import { useSWRAuth } from "~/lib/swr";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";
import { DEPARTURE_MODE_LABELS } from "~/lib/departure-plan";

// Die Historie kennt nur entschiedene Anfragen; hier kommt der offene Status
// dazu, mit demselben Wort wie in der Arbeitsliste.
const PENDING_META: { label: string; tone: StatusBadgeTone } = {
  label: "Offen",
  tone: "blue",
};

const CLOSED_STATUS_META: Partial<
  Record<
    StaffCareRequestDetail["status"],
    {
      label: string;
      tone: StatusBadgeTone;
      explanation: string;
    }
  >
> = {
  done: {
    label: "Abgeschlossen",
    tone: "gray",
    explanation: "Die Anfrage wurde abgeschlossen. Der Tag ist bereits vorbei.",
  },
  care_ended: {
    label: "Betreuung beendet",
    tone: "gray",
    explanation:
      "Die Betreuung des Kindes ist beendet. Die Anfrage wurde geschlossen.",
  },
};

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly detail: StaffCareRequestDetail }
  | { readonly kind: "gone" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "failed" };

/**
 * Eine entfernte Anfrage und fehlende Rechte sind kein Ladefehler, sondern
 * ein erklärter Zustand: der Hinweis im Verlauf bleibt (#2517: am Code
 * erkannt).
 */
function explainedState(err: unknown): "gone" | "forbidden" | null {
  if (!(err instanceof ApiError)) return null;
  const code = wireErrorCode(err.code);
  if (code === "care.request_not_found") return "gone";
  if (code === "general.permission") return "forbidden";
  return null;
}

function clockLabel(time: string): string {
  return `${time} Uhr`;
}

export function PickupRequestDetailModal({
  requestId,
  onClose,
  onOpenQueue,
}: Readonly<{
  /** Zeilen-ID der Anfrage; `null` hält das Fenster geschlossen. */
  requestId: string | null;
  onClose: () => void;
  /**
   * Weg zur Seite, auf der entschieden wird. Nur für eine noch offene
   * Anfrage angeboten; wer nicht entscheiden darf, übergibt nichts.
   */
  onOpenQueue?: () => void;
}>) {
  const discard = useDiscardRefusedEntity();
  const key = requestId ? tenantContactKeys.careRequest(requestId) : null;
  const { data, error, mutate } = useSWRAuth(
    key,
    () => fetchCareScheduleChangeRequest(requestId ?? ""),
    {
      keepPreviousData: false,
      onError: (failure) => {
        if (key !== null)
          discard(failure, {
            codes: ["general.permission", "care.request_not_found"],
            matches: (candidate) => candidate === key,
            refusedKey: key,
          });
      },
      shouldRetryOnError: (err: unknown) => explainedState(err) === null,
    },
  );
  const explained = explainedState(error);
  // Ein echter Ladefehler steht im Fenster, mit Wiederholen (#2517).
  const loadError = useSwrResourceLoadError(
    [{ data, error: explained ? undefined : error }],
    "die Anfrage",
    () => mutate(),
  );
  const state: LoadState = explained
    ? { kind: explained }
    : data !== undefined
      ? { kind: "loaded", detail: data }
      : loadError.failure !== undefined
        ? { kind: "failed" }
        : { kind: "loading" };

  const pending = state.kind === "loaded" && state.detail.status === "pending";

  return (
    <Modal
      isOpen={requestId !== null}
      onClose={onClose}
      title={
        state.kind === "loaded" &&
        state.detail.request_kind === "pickup_permission"
          ? "Anfrage: Abholberechtigung"
          : detailTitle(
              state.kind === "loaded" ? state.detail.pickup_change : undefined,
            )
      }
      mobileSheet
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            noTooltip="Schließt nur das Fenster, das Wort sagt es."
          >
            Schließen
          </Button>
          {pending && onOpenQueue && (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={onOpenQueue}
              tooltip="Öffnet die offenen Anfragen der Eltern zum Entscheiden."
            >
              Zu den Anfragen
            </Button>
          )}
        </div>
      }
    >
      {(state.kind === "loading" ||
        (state.kind === "failed" &&
          formErrorMessage(loadError.error) === null)) && (
        <InfoSection title="Beantragt" icon={DetailIcons.document}>
          <DataGrid>
            <DataFieldSkeleton />
            <DataFieldSkeleton />
            <DataFieldSkeleton />
            <DataFieldSkeleton fullWidth />
          </DataGrid>
        </InfoSection>
      )}
      {state.kind === "gone" && (
        <Alert
          type="info"
          message="Diese Anfrage gibt es nicht mehr. Der Hinweis im Verlauf bleibt erhalten."
        />
      )}
      {state.kind === "forbidden" && (
        <Alert
          type="info"
          message="Für dieses Kind darfst du keine Anfragen ansehen."
        />
      )}
      {state.kind === "failed" && <LoadErrorAlert error={loadError.error} />}
      {state.kind === "loaded" && <DetailBody detail={state.detail} />}
    </Modal>
  );
}

/** „Anfrage: Abholzeit“, „Anfrage: Abholart“ oder beides (#3945). */
function detailTitle(pickup: StaffCareRequestDetail["pickup_change"]): string {
  if (pickup?.pickup_person && !pickup.pickup_time && !pickup.departure_mode)
    return "Anfrage: Abholperson";
  if (pickup?.departure_mode && pickup.pickup_time)
    return "Anfrage: Abholzeit und Abholart";
  if (pickup?.departure_mode) return "Anfrage: Abholart";
  return "Anfrage: Abholzeit";
}

function DetailBody({ detail }: Readonly<{ detail: StaffCareRequestDetail }>) {
  const closedMeta = CLOSED_STATUS_META[detail.status];
  const meta = HISTORY_STATUS_META[detail.status] ?? closedMeta ?? PENDING_META;
  // Nur Abholzeit-Hinweise öffnen dieses Fenster; ein Antrag ohne lesbaren
  // Tag zeigt „Keine Angabe" statt eines erfundenen Werts.
  const pickup = detail.pickup_change;
  // Eine Abholberechtigung hat keinen Tag und keine Abholzeit (#4780).
  const isPermission = detail.request_kind === "pickup_permission";
  return (
    <div className="space-y-3">
      <InfoSection title="Beantragt" icon={DetailIcons.document}>
        <DataGrid>
          <DataField label="Kind">
            {detail.first_name} {detail.last_name}
          </DataField>
          {!isPermission && (
            <DataField label="Tag">
              {pickup ? formatDate(pickup.date) : "Keine Angabe"}
            </DataField>
          )}
          {!isPermission && (!pickup || pickup.pickup_time) && (
            <>
              <DataField label="Gewünschte Abholzeit">
                {pickup?.pickup_time
                  ? clockLabel(pickup.pickup_time)
                  : "Keine Angabe"}
              </DataField>
              <DataField label="Abholzeit vorher">
                {pickup?.previous_pickup_time
                  ? clockLabel(pickup.previous_pickup_time)
                  : "Keine Angabe"}
              </DataField>
            </>
          )}
          {pickup?.departure_mode && (
            <>
              <DataField label="Gewünschte Abholart">
                {DEPARTURE_MODE_LABELS[pickup.departure_mode]}
              </DataField>
              <DataField label="Abholart vorher">
                {pickup.previous_departure_modes?.length
                  ? pickup.previous_departure_modes
                      .map((mode) => DEPARTURE_MODE_LABELS[mode])
                      .join(", ")
                  : "Keine Angabe"}
              </DataField>
            </>
          )}
          {pickup?.pickup_person && (
            <DataField label="Abholperson an diesem Tag">
              {pickup.pickup_person}
            </DataField>
          )}
          {detail.request_kind === "pickup_permission" &&
            detail.requested.map((entry) => (
              <DataField key={entry.label} label={entry.label} fullWidth>
                {entry.new}
              </DataField>
            ))}
          <DataField label="Grund der Eltern" fullWidth>
            {detail.request_reason ?? "Keine Angabe"}
          </DataField>
          <DataField label="Eingegangen">
            {formatChatDateTime(detail.created_at)}
          </DataField>
        </DataGrid>
      </InfoSection>

      <InfoSection
        title={closedMeta ? "Abschluss" : "Entscheidung"}
        icon={DetailIcons.notes}
      >
        <div className="mb-2">
          <StatusBadge label={meta.label} tone={meta.tone} />
        </div>
        {detail.status === "pending" && (
          <InfoText>
            Noch nicht entschieden. Entschieden wird unter Anfragen.
          </InfoText>
        )}
        {detail.status === "withdrawn" && (
          <InfoText>
            Die Eltern haben die Anfrage zurückgezogen
            {detail.decided_at
              ? ` (${formatChatDateTime(detail.decided_at)})`
              : ""}
            .
          </InfoText>
        )}
        {(detail.status === "approved" || detail.status === "rejected") && (
          <DataGrid>
            <DataField label="Entschieden am">
              {detail.decided_at
                ? formatChatDateTime(detail.decided_at)
                : "Keine Angabe"}
            </DataField>
            <DataField label="Entschieden von">
              {detail.decided_by_name ?? "Keine Angabe"}
            </DataField>
            <DataField label="Begründung der OGS" fullWidth>
              {detail.decision_reason ?? "Keine Angabe"}
            </DataField>
          </DataGrid>
        )}
        {closedMeta && (
          <>
            <InfoText>{closedMeta.explanation}</InfoText>
            <DataGrid>
              <DataField label="Geschlossen am">
                {detail.decided_at
                  ? formatChatDateTime(detail.decided_at)
                  : "Keine Angabe"}
              </DataField>
              <DataField label="Geschlossen von">
                {detail.decided_by_name ?? "Keine Angabe"}
              </DataField>
              <DataField label="Grund der Schließung" fullWidth>
                {detail.decision_reason ?? "Keine Angabe"}
              </DataField>
            </DataGrid>
          </>
        )}
      </InfoSection>
    </div>
  );
}
