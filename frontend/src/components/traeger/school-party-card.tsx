"use client";

// Schulträger oder Gemeinde einer Schule (#4811): die Angaben, die auf
// Verträgen stehen und die Abrechnung braucht. Ohne diese Angaben bleibt der
// Träger zuständig, auch wenn die Einstellung die Stelle nennt.

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EmptyState } from "~/components/ui/empty-state";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { organizationsConcept } from "~/lib/concepts/organizations";
import { createLogger } from "~/lib/logger";
import {
  type AreaResponsibility,
  RESPONSIBILITY_AREA_LABELS,
  RESPONSIBLE_BODY_LABELS,
  type SchoolParty,
  type SchoolPartyKind,
  billingReady,
  removeSchoolParty,
} from "~/lib/traeger-responsibilities-api";
import { SchoolPartyModal } from "./school-party-modal";
import { formatIBAN } from "./traeger-bank-account-format";

const logger = createLogger({ component: "SchoolPartyCard" });

const EMPTY_VALUE = "–";

const DESCRIPTIONS: Record<SchoolPartyKind, string> = {
  schultraeger:
    "Der Schulträger dieser Schule, zum Beispiel die Stadt. Die Angaben gelten nur für diese Schule.",
  gemeinde:
    "Die Gemeinde dieser Schule. Die Angaben gelten nur für diese Schule.",
};

/** „Verträge und Personal“ for the areas the body is chosen for. */
function areaList(areas: readonly AreaResponsibility[]): string {
  const labels = areas.map((area) => RESPONSIBILITY_AREA_LABELS[area.area]);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} und ${labels.at(-1)}`;
}

function Lines({ lines }: Readonly<{ lines: readonly string[] }>) {
  const shown = lines.filter((line) => line.trim() !== "");
  if (shown.length === 0) return EMPTY_VALUE;
  return (
    <span className="flex flex-col wrap-anywhere">
      {shown.map((line, index) => (
        // Lines of one address or account: the position is the identity.
        // oxlint-disable-next-line react/no-array-index-key
        <span key={index}>{line}</span>
      ))}
    </span>
  );
}

export function SchoolPartyCard({
  schoolId,
  schoolName,
  kind,
  party,
  areas,
  canEdit,
  reload,
  onChanged,
}: Readonly<{
  schoolId: string;
  schoolName: string;
  kind: SchoolPartyKind;
  /** The stored body; undefined while the school has none of this kind. */
  party: SchoolParty | undefined;
  /** The areas of the school, to say what the body is chosen for. */
  areas: readonly AreaResponsibility[];
  canEdit: boolean;
  /** Reads the body again after a refused save; rejects on failure. */
  reload: () => Promise<SchoolParty | undefined>;
  /** Reloads the page; never rejects (#6652). */
  onChanged: RefreshAfterWrite;
}>) {
  const label = RESPONSIBLE_BODY_LABELS[kind];
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const removeErrors = useApiFormError();
  const { success } = useToast();
  const chosen = areas.filter((area) => area.body === kind);
  const wantsBilling = chosen.some((area) => area.area === "billing");

  const remove = async () => {
    setBusy(true);
    removeErrors.clear();
    try {
      await removeSchoolParty(schoolId, kind);
    } catch (error) {
      logger.error("school_party_remove_failed", {
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
      void removeErrors.show(error, {
        object: `das Entfernen der Angaben: ${label}`,
      });
      setBusy(false);
      return;
    }
    setBusy(false);
    setRemoving(false);
    success(`${label}: Die Angaben sind entfernt.`);
    await onChanged();
  };

  // The body counts only where it is responsible in effect: chosen for
  // billing without creditor identifier or account, the Träger still bills.
  const effective = areas.filter((area) => area.effective === kind);
  const waiting = chosen.length > effective.length;
  const badge = (
    <>
      {effective.length > 0 ? (
        <StatusBadge
          tone="green"
          label={`Zuständig für ${areaList(effective)}`}
        />
      ) : null}
      {waiting ? (
        <StatusBadge
          tone="warning"
          label={party ? "Gläubiger-ID oder Konto fehlt" : "Angaben fehlen"}
        />
      ) : null}
    </>
  );

  return (
    <SectionCard
      leading={<ConceptIconTile concept={organizationsConcept} />}
      title={label}
      titleBadge={badge}
      description={DESCRIPTIONS[kind]}
      actions={
        canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              tooltip={
                party
                  ? `Öffnet die Angaben: ${label} zum Ändern.`
                  : `Öffnet ein Fenster für Name, Anschrift und Bankverbindung: ${label}.`
              }
              onClick={() => setEditing(true)}
            >
              {party ? (
                <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {party ? "Ändern" : "Angaben eintragen"}
            </Button>
            {party ? (
              <OverflowMenu
                ariaLabel={`Weitere Aktionen: ${label}`}
                items={[
                  {
                    label: "Angaben entfernen",
                    description:
                      "Entfernt die Angaben dieser Schule. moto fragt vorher nach.",
                    icon: <Trash2 className="size-4" aria-hidden />,
                    destructive: true,
                    onClick: () => setRemoving(true),
                  },
                ]}
              />
            ) : null}
          </div>
        ) : null
      }
    >
      {party ? (
        <DataGrid columns={2}>
          <DataField label="Name und Anschrift">
            <Lines
              lines={[
                party.name,
                party.street,
                `${party.postalCode} ${party.city}`,
              ]}
            />
          </DataField>
          <DataField label="Ansprechperson">
            <Lines
              lines={[
                party.contactName,
                party.contactPhone,
                party.contactEmail,
              ]}
            />
          </DataField>
          <DataField label="Gläubiger-ID">
            {party.creditorId ? (
              <span className="font-mono tracking-wide">
                {party.creditorId}
              </span>
            ) : (
              EMPTY_VALUE
            )}
          </DataField>
          <DataField label="Bankverbindung">
            {party.iban ? (
              <Lines
                lines={[
                  party.accountHolder,
                  formatIBAN(party.iban),
                  [party.bankName, party.bic].filter(Boolean).join(" · "),
                ]}
              />
            ) : (
              EMPTY_VALUE
            )}
          </DataField>
          {wantsBilling && !billingReady(party) ? (
            <DataField label="Für die Abrechnung" fullWidth>
              <span className="text-sm font-normal text-gray-600">
                Es fehlen Gläubiger-ID oder Bankverbindung. Bis du sie
                einträgst, bleibt der Träger für die Abrechnung zuständig.
              </span>
            </DataField>
          ) : null}
        </DataGrid>
      ) : (
        <EmptyState
          variant="compact"
          title="Noch keine Angaben"
          description={
            chosen.length > 0
              ? `Die Einstellung nennt ${label === "Gemeinde" ? "die Gemeinde" : "den Schulträger"} für ${areaList(chosen)}. Solange Name und Anschrift fehlen, bleibt der Träger zuständig.`
              : "Du brauchst sie erst, wenn diese Stelle Verträge schließt, abrechnet oder Personal anstellt."
          }
        />
      )}
      <SchoolPartyModal
        open={editing}
        schoolId={schoolId}
        schoolName={schoolName}
        kind={kind}
        party={party}
        reload={reload}
        onClose={() => setEditing(false)}
        onSaved={onChanged}
      />
      <ConfirmDeleteModal
        isOpen={removing}
        onClose={() => {
          setRemoving(false);
          removeErrors.clear();
        }}
        onConfirm={() => void remove()}
        title={`Angaben entfernen: ${label}?`}
        description={
          chosen.length > 0
            ? `Für ${areaList(chosen)} ist danach wieder der Träger zuständig. Schon verschickte Verträge bleiben, wie sie sind.`
            : "Nennt eine Einstellung später diese Stelle, bleibt der Träger zuständig, bis du die Angaben neu einträgst."
        }
        confirmLabel="Entfernen"
        loadingLabel="Wird entfernt …"
        gate={{ mode: "twoStep", firstStepLabel: "Ja, entfernen" }}
        loading={busy}
        error={removeErrors.error}
      />
    </SectionCard>
  );
}
