"use client";

// Die Nachweise einer Personalakte (#4707, ADR 0089 Abschnitt 7): jede Art
// des Trägers mit ihrem Stand. Fehlt ein Pflichtnachweis oder läuft einer
// ab, steht das hier und auf der Liste „Personalnachweise“. Eintragen und
// Erneuern öffnen den Dialog; ein versehentlich eingetragener Nachweis lässt
// sich entfernen.

import { ArrowClockwiseIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { EmptyState } from "~/components/ui/empty-state";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { documentsConcept } from "~/lib/concepts/documents";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  deleteStaffProof,
  STAFF_PROOF_STATUS,
  type StaffProof,
} from "~/lib/traeger-staff-proofs-api";
import { StaffProofModal, type StaffProofTarget } from "./staff-proof-modal";

const logger = createLogger({ component: "TraegerStaffProofsCard" });

/** The line under the kind: what moto knows of the proof. */
function staffProofDetail(proof: StaffProof): string {
  if (!proof.held) {
    return proof.mandatory
      ? "Pflicht · noch nicht eingetragen"
      : "Freiwillig · noch nicht eingetragen";
  }
  const parts = [
    proof.policeCertificate
      ? `Eingesehen am ${formatDate(proof.presentedOn)}`
      : `Vorgelegt am ${formatDate(proof.presentedOn)}`,
  ];
  if (proof.policeCertificate && proof.issuedOn) {
    parts.push(`ausgestellt am ${formatDate(proof.issuedOn)}`);
  }
  if (proof.policeCertificate && proof.noRelevantEntry) {
    parts.push("keine einschlägige Eintragung");
  }
  parts.push(
    proof.expiresOn
      ? `gültig bis ${formatDate(proof.expiresOn)}`
      : "läuft nicht ab",
  );
  return parts.join(" · ");
}

export function StaffProofsCard({
  recordId,
  personName,
  proofs,
  onChanged,
}: Readonly<{
  recordId: string;
  personName: string;
  proofs: readonly StaffProof[];
  onChanged: (proofs: StaffProof[]) => void;
}>) {
  const [target, setTarget] = useState<StaffProofTarget | null>(null);
  const [removing, setRemoving] = useState<StaffProof | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteErrors = useApiFormError();
  const { success } = useToast();
  const open = proofs.filter(
    (proof) => proof.status !== "" && proof.status !== "valid",
  ).length;

  const remove = async () => {
    if (!removing) return;
    setDeleting(true);
    try {
      onChanged(await deleteStaffProof(recordId, removing.typeId));
      success(`„${removing.typeName}“ von ${personName} ist entfernt.`);
      setRemoving(null);
    } catch (err) {
      logger.error("traeger_staff_proof_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void deleteErrors.show(err, { object: "der Nachweis" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SectionCard
      concept={documentsConcept}
      title="Nachweise"
      description="Führungszeugnis, Masernschutz und die anderen Nachweise, die Ihr Träger verlangt. Die Leitung jedes Einsatzorts sieht nur den Stand."
      action={
        open > 0 ? (
          <StatusBadge
            label={open === 1 ? "1 offen" : `${open} offen`}
            tone="warning"
          />
        ) : proofs.length > 0 ? (
          <StatusBadge label="Vollständig" tone="green" />
        ) : undefined
      }
    >
      {proofs.length > 0 ? (
        <ResponsiveActionList>
          {proofs.map((proof) => (
            <ResponsiveActionRow key={proof.typeId}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                  <span className="min-w-0 wrap-anywhere">
                    {proof.typeName}
                  </span>
                  {proof.status ? (
                    <StatusBadge
                      label={STAFF_PROOF_STATUS[proof.status].label}
                      tone={STAFF_PROOF_STATUS[proof.status].tone}
                    />
                  ) : null}
                </p>
                <p className="mt-0.5 text-sm text-gray-600 tabular-nums">
                  {staffProofDetail(proof)}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="surface"
                  size="compact"
                  className="gap-1.5"
                  aria-label={`${proof.typeName} ${proof.held ? "erneuern" : "eintragen"}`}
                  tooltip={
                    proof.held
                      ? "Ersetzt den Nachweis durch einen neuen. Der alte Stand wird nicht aufbewahrt."
                      : "Öffnet das Formular, um den Nachweis einzutragen."
                  }
                  onClick={() => setTarget({ recordId, personName, proof })}
                >
                  {proof.held ? (
                    <ArrowClockwiseIcon className="size-4" aria-hidden="true" />
                  ) : (
                    <PlusIcon className="size-4" aria-hidden="true" />
                  )}
                  {proof.held ? "Erneuern" : "Eintragen"}
                </Button>
                {proof.held ? (
                  <OverflowMenu
                    ariaLabel={`Weitere Aktionen zu ${proof.typeName}`}
                    items={[
                      {
                        label: "Eintrag entfernen",
                        description:
                          "Für einen Eintrag aus Versehen. moto fragt vorher nach.",
                        icon: (
                          <TrashIcon className="size-4" aria-hidden="true" />
                        ),
                        destructive: true,
                        onClick: () => {
                          deleteErrors.clear();
                          setRemoving(proof);
                        },
                      },
                    ]}
                  />
                ) : (
                  // Keeps the buttons of every row in one column.
                  <span className="size-8 shrink-0" aria-hidden="true" />
                )}
              </div>
            </ResponsiveActionRow>
          ))}
        </ResponsiveActionList>
      ) : (
        <EmptyState
          variant="compact"
          title="Ihr Träger verlangt noch keinen Nachweis."
          description="Legen Sie die Nachweisarten unter „Personalnachweise“ an."
        />
      )}
      <StaffProofModal
        target={target}
        onClose={() => setTarget(null)}
        onSaved={(next) => {
          setTarget(null);
          onChanged(next);
        }}
      />
      <ConfirmDeleteModal
        isOpen={removing !== null}
        onClose={() => {
          if (deleting) return;
          setRemoving(null);
        }}
        onConfirm={() => void remove()}
        title="Eintrag entfernen?"
        description={
          removing ? (
            <p>
              Der Nachweis „{removing.typeName}“ von{" "}
              <span className="font-medium text-gray-900">{personName}</span>{" "}
              wird entfernt. Ist er Pflicht, steht er danach wieder als „Fehlt“
              auf der Liste.
            </p>
          ) : null
        }
        gate={{ mode: "twoStep" }}
        confirmLabel="Eintrag entfernen"
        loadingLabel="Wird entfernt …"
        loading={deleting}
        error={deleteErrors.error}
      />
    </SectionCard>
  );
}
