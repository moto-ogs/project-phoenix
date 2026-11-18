"use client";

// Regeln des Monatsbeitrags (#4685): Einkommensstufen, Geschwister,
// Alleinerziehende und Höchstbetrag, je eine Karte in der Reihenfolge, in
// der der Monatslauf sie anwendet. Die Nachweise der Kinder liegen auf der
// Seite „Nachweise“.

import { Tags } from "lucide-react";
import { useState } from "react";
import {
  billingAreaTitle,
  billingTabs,
} from "~/components/traeger/billing-family-format";
import { formatMonth, monthOf } from "~/components/traeger/care-billing-format";
import { CareRuleModal } from "~/components/traeger/care-rule-modal";
import { CareRulesCard } from "~/components/traeger/care-rules-card";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { EmptyState } from "~/components/ui/empty-state";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { berlinTodayISO } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  CARE_RULE_KINDS,
  type CareRule,
  type CareRuleKind,
  deleteCareRule,
  fetchCareRules,
} from "~/lib/traeger-care-reductions-api";

const logger = createLogger({ component: "TraegerErmaessigungenPage" });

export default function TraegerErmaessigungenPage() {
  const currentMonth = monthOf(berlinTodayISO());
  const {
    data,
    loading,
    error: loadError,
    mutate,
  } = useTraegerResource(
    traegerBillingKeys.careRules(),
    fetchCareRules,
    "die Übersicht der Ermäßigungen",
  );
  const [editing, setEditing] = useState<{
    kind: CareRuleKind;
    rule: CareRule | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<CareRule | null>(null);
  const [busy, setBusy] = useState(false);
  const deleteErrors = useApiFormError();
  const { success } = useToast();

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    deleteErrors.clear();
    try {
      await mutate(await deleteCareRule(deleting.id), { revalidate: false });
      success(`Die Regel „${deleting.name}“ ist gelöscht.`);
      setDeleting(null);
    } catch (err) {
      logger.error("care_rule_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void deleteErrors.show(err, { object: "die Regel" });
    } finally {
      setBusy(false);
    }
  };

  const active = data
    ? data.rules.filter(
        (rule) =>
          rule.validFrom <= currentMonth &&
          (rule.validUntil === null || rule.validUntil >= currentMonth),
      ).length
    : 0;

  return (
    <TenantPage
      title={billingAreaTitle("ermaessigungen")}
      info="Hier legen Sie fest, wann Familien weniger zahlen. Der Monatslauf rechnet in dieser Reihenfolge: Preis aus der Preisliste, Einkommensstufe, Geschwister, Alleinerziehende, Höchstbetrag. Jede Ermäßigung steht als eigene Zeile auf der Rechnung."
      stats={
        data && data.rules.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: data.rules.length,
                label: data.rules.length === 1 ? "Regel" : "Regeln",
              },
              {
                value: active,
                label: `gelten im ${formatMonth(currentMonth)}`,
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      tabs={billingTabs("ermaessigungen")}
      error={loadError}
      loading={loading}
      overlays={
        data ? (
          <>
            <CareRuleModal
              data={data}
              open={editing}
              currentMonth={currentMonth}
              onClose={() => setEditing(null)}
              onSaved={(next) => {
                void mutate(next, { revalidate: false });
                setEditing(null);
              }}
            />
            <ConfirmDeleteModal
              isOpen={deleting !== null}
              onClose={() => {
                setDeleting(null);
                deleteErrors.clear();
              }}
              onConfirm={() => void remove()}
              title="Regel löschen?"
              description={
                deleting
                  ? `„${deleting.name}“ gilt ab dem nächsten Monatslauf nicht mehr. Ausgestellte Rechnungen bleiben, wie sie sind.`
                  : ""
              }
              confirmLabel="Löschen"
              loadingLabel="Wird gelöscht …"
              gate={{ mode: "twoStep", firstStepLabel: "Ja, löschen" }}
              loading={busy}
              error={deleteErrors.error}
            />
          </>
        ) : null
      }
    >
      {data && data.schools.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-12 w-12" aria-hidden="true" />}
          title="Noch keine Schule."
          description="Ermäßigungen gibt es für die Schulen Ihres Trägers."
        />
      ) : null}
      {/* Equal rule cards in a grid: grids do not grow (TenantPage body
          rule), so the last kind keeps its height like its siblings. */}
      {data && data.schools.length > 0 ? (
        <div className="compact:gap-4 grid gap-6 max-sm:gap-3">
          {CARE_RULE_KINDS.map((kind) => (
            <CareRulesCard
              key={kind}
              kind={kind}
              data={data}
              currentMonth={currentMonth}
              onCreate={() => setEditing({ kind, rule: null })}
              onEdit={(rule) => setEditing({ kind, rule })}
              onDelete={setDeleting}
            />
          ))}
        </div>
      ) : null}
    </TenantPage>
  );
}
