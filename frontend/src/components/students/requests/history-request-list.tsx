"use client";

/**
 * Die Historie als eine Liste read-only Zeilen (#2432). Seit #2267 trägt eine
 * entschiedene Zeile zusätzlich „Entscheidung korrigieren", sobald das
 * Backend sie dafür freigibt (`can_correct`).
 */

import { useState } from "react";

import { EnrollmentRequestItem } from "~/components/students/enrollment-request-item";
import { RequestHistoryItem } from "~/components/students/request-history-item";
import { RequestRowHeader } from "~/components/students/request-review-card";
import type { CareWithdrawalCompletion } from "~/lib/care-exit-api";
import type { AggregatedHistoryRequest } from "~/lib/change-request-list-api";
import { itemKey, type AnyItem } from "./case-model";
import {
  DecisionCorrectionDialog,
  type CorrectionTarget,
} from "./decision-correction-dialog";
import { HistoryWithdrawalCard } from "./withdrawal-cards";
import { SectionCard } from "~/components/ui/section-card";

/**
 * Arten, bei denen die Schätzung unten KEINE Korrektur anbietet. Achtung: das
 * ist gröber als die Wahrheit. Eine Abholzeit-Änderung liegt in derselben
 * Warteschlange wie ein Wochenplan (`care_schedule`), lässt sich aber sehr
 * wohl zurücknehmen — nur ein Wochenplan nicht, weil sein Schnappschuss
 * Anzeige ist und kein Ausgangszustand. Aus der Zeile allein sind die beiden
 * nicht zu unterscheiden; deshalb entscheidet `can_correct` und die Schätzung
 * greift nur, solange das Feld fehlt.
 */
const UNCORRECTABLE_KINDS: readonly string[] = ["care_schedule", "offering"];

const DECIDED_STATUSES: readonly string[] = ["approved", "rejected"];

/**
 * Darf diese Zeile korrigiert werden? Maßgeblich ist `can_correct` des
 * Backends — es kennt den Unterschied zwischen einer Abholzeit und einem
 * Wochenplan, den diese Zeile nicht sieht. Nur wenn das Feld fehlt, wird
 * vorsichtig geschätzt: eine entschiedene Zeile einer Art, die eine Rücknahme
 * sicher zulässt. Die Schätzung verschweigt dabei die Abholzeit-Korrektur;
 * das ist der Preis dafür, keine Korrektur anzubieten, die sicher scheitert.
 */
function mayCorrect(
  canCorrect: boolean | undefined,
  requestType: string,
  status: string | undefined,
): boolean {
  if (canCorrect === true) return true;
  if (canCorrect === false) return false;
  return (
    DECIDED_STATUSES.includes(status ?? "") &&
    !UNCORRECTABLE_KINDS.includes(requestType)
  );
}

function correctionTarget(item: AnyItem): CorrectionTarget | null {
  const { request_type: kind, data } = item;
  if (
    kind !== "master_data" &&
    kind !== "care_schedule" &&
    kind !== "offering" &&
    kind !== "excused"
  )
    return null;
  const canCorrect = "can_correct" in item ? item.can_correct : undefined;
  if (!mayCorrect(canCorrect, item.request_type, data.status)) return null;
  return {
    kind,
    requestID: data.id,
    expectedVersion:
      ("expected_version" in item ? item.expected_version : undefined) ?? "",
    childName:
      "student_name" in data
        ? data.student_name
        : `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim(),
    priorStatus: data.status ?? "",
    priorDecidedAt: "decided_at" in data ? data.decided_at : undefined,
    priorDecidedBy:
      "decided_by_name" in data ? data.decided_by_name : undefined,
    priorReason:
      ("reason" in data ? data.reason : undefined) ??
      ("decision_reason" in data ? data.decision_reason : undefined) ??
      ("review_reason" in data ? data.review_reason : undefined),
  };
}

export function HistoryRequestList({
  items,
  withdrawals,
  reasonRequired,
  onCorrected,
  onStale,
}: Readonly<{
  items: readonly AnyItem[];
  withdrawals: readonly CareWithdrawalCompletion[];
  reasonRequired: boolean;
  onCorrected: (notice: string) => void;
  /** Lädt die Liste neu, wenn eine Korrektur auf einem veralteten Stand lag. */
  onStale: () => Promise<unknown>;
}>) {
  const [target, setTarget] = useState<CorrectionTarget | null>(null);
  return (
    <SectionCard padding="none">
      <RequestRowHeader view="history" />
      {withdrawals.map((row) => (
        <HistoryWithdrawalCard key={`care_withdrawal:${row.id}`} row={row} />
      ))}
      {items.map((item) => {
        if (item.request_type === "enrollment") {
          return (
            <EnrollmentRequestItem
              key={itemKey(item)}
              row={item.data}
              view="history"
            />
          );
        }
        const correctable = correctionTarget(item);
        return (
          <RequestHistoryItem
            key={itemKey(item)}
            item={item as AggregatedHistoryRequest}
            onCorrect={correctable ? () => setTarget(correctable) : undefined}
          />
        );
      })}
      {target && (
        <DecisionCorrectionDialog
          target={target}
          reasonRequired={reasonRequired}
          onClose={() => setTarget(null)}
          onCorrected={(notice: string) => {
            setTarget(null);
            onCorrected(notice);
          }}
          onStale={() => {
            setTarget(null);
            return onStale();
          }}
        />
      )}
    </SectionCard>
  );
}
