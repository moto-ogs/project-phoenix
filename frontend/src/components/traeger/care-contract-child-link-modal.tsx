"use client";

// Einen importierten Vertrag einzeln mit der Kinderakte verknüpfen (#7760,
// ADR 0307 Punkt 2). Das Büro gibt die Nummer der Kinderakte ein; moto zeigt
// nebeneinander, was im Vertrag und was in der Kinderakte steht. Weichen
// Name oder Geburtsdatum ab, kann das Büro das hier bewusst bestätigen; jedes
// andere Hindernis erklärt der Dialog und verknüpft nichts.

import { useRef, useState } from "react";
import Link from "next/link";
import { Alert } from "~/components/ui/alert";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Input } from "~/components/ui/input";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError, wireErrorCode } from "~/lib/api-error";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  linkContractChild,
  previewContractChildLink,
  type ChildLinkPerson,
  type ChildLinkRow,
} from "~/lib/traeger-contract-child-links-api";
import { traegerPath } from "~/lib/traeger-url";
import {
  type ChildLinkDifference,
  childLinkDifference,
  childLinkDifferenceText,
  childLinkName,
  childLinkSingleBlock,
} from "./care-contract-child-link-format";

const logger = createLogger({ component: "CareContractChildLinkModal" });

const FIELD = "student_id";

/** Die Nummer, wie das Büro sie tippt: nur Ziffern, ohne Leerzeichen. */
function typedNumber(value: string): string | null {
  const trimmed = value.trim();
  // Ohne führende Nullen: so nennt auch die Antwort die Nummer.
  // Als Text, damit auch eine sehr lange Nummer genau so ankommt.
  const digits = trimmed.replace(/^0+/, "");
  return /^\d+$/.test(trimmed) && digits !== "" ? digits : null;
}

function Side({
  title,
  person,
  schoolName,
  difference,
}: Readonly<{
  title: string;
  person: ChildLinkPerson;
  schoolName: string;
  difference: ChildLinkDifference;
}>) {
  const marked = (changed: boolean, value: string) =>
    changed ? (
      <span className="flex flex-col items-start gap-1">
        <span className="font-semibold">{value}</span>
        <StatusBadge tone="warning" size="xs" label="Weicht ab" />
      </span>
    ) : (
      value
    );
  return (
    <InsetPanel tone="white" padding="md" framed as="section">
      <SectionLabel as="h3" className="mb-3">
        {title}
      </SectionLabel>
      <DataGrid columns={1}>
        <DataField label="Name">
          {marked(difference.name, childLinkName(person))}
        </DataField>
        <DataField label="Geboren am">
          {marked(
            difference.birthDate,
            person.birthDate ? formatDate(person.birthDate) : "–",
          )}
        </DataField>
        <DataField label="Schule">{schoolName || "–"}</DataField>
      </DataGrid>
    </InsetPanel>
  );
}

export function CareContractChildLinkModal({
  contractId,
  isOpen,
  onClose,
  onLinked,
}: Readonly<{
  contractId: string;
  isOpen: boolean;
  onClose: () => void;
  onLinked: (row: ChildLinkRow) => void;
}>) {
  const [number, setNumber] = useState("");
  // The comparison belongs to the number it was read for; typing another
  // number asks again.
  const [preview, setPreview] = useState<ChildLinkRow | null>(null);
  const save = useFormModalPending(isOpen);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);

  // A new opening starts empty.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setNumber("");
      setPreview(null);
    }
  }

  const shown =
    preview && preview.studentId === typedNumber(number) ? preview : null;
  const block = shown ? childLinkSingleBlock(shown) : null;
  const linked = shown?.status === "linked";
  const difference = shown
    ? childLinkDifference(shown.contract, shown.student)
    : { name: false, birthDate: false };
  const onlyDiffers =
    shown !== null &&
    block === null &&
    shown.problems.some((problem) => problem.code === "differs");
  const childUnknown =
    shown?.problems.some(
      (problem) => problem.field === "child" && problem.code === "unknown",
    ) ?? false;
  // A number the school does not know is a field error: the person types
  // another one and checks again.
  const compared = shown && !childUnknown ? shown : null;

  const check = async (studentId: string) => {
    await save.run(async (op) => {
      try {
        const row = await previewContractChildLink(contractId, studentId);
        if (!op.isCurrent()) return;
        setPreview(row);
        if (
          row.problems.some(
            (problem) =>
              problem.field === "child" && problem.code === "unknown",
          )
        ) {
          formErrors.invalid("Prüfe die Nummer der Kinderakte.", {
            [FIELD]:
              "Die Schule des Vertrags hat keine Kinderakte mit dieser Nummer.",
          });
        }
      } catch (err) {
        logger.error("traeger_contract_child_link_preview_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (op.isCurrent()) {
          void formErrors.show(err, { object: "die Kinderakte" });
        }
      }
    });
  };

  const link = async (studentId: string, seen: ChildLinkRow) => {
    await save.run(async (op) => {
      try {
        const stored = await linkContractChild(
          contractId,
          studentId,
          onlyDiffers,
          seen.fingerprint,
        );
        if (op.isCurrent()) onLinked(stored);
      } catch (err) {
        logger.error("traeger_contract_child_link_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        void formErrors.show(err, { object: "die Verknüpfung" });
        if (
          err instanceof ApiError &&
          (err.code === wireErrorCode("care_contract.child_link_refused") ||
            err.code === wireErrorCode("care_contract.child_link_changed"))
        ) {
          // Something changed since the comparison: show the current one
          // and why it holds the link back.
          try {
            const fresh = await previewContractChildLink(contractId, studentId);
            if (op.isCurrent()) setPreview(fresh);
          } catch {
            // Silent on purpose: the alert above already says that the link
            // failed; without a fresh comparison the dialog asks again.
            if (op.isCurrent()) setPreview(null);
          }
        }
      }
    });
  };

  const submit = async () => {
    formErrors.clear();
    const studentId = typedNumber(number);
    if (studentId === null) {
      formErrors.invalid("Bitte gib die Nummer der Kinderakte ein.", {
        [FIELD]:
          number.trim() === ""
            ? "Bitte eine Nummer eingeben."
            : "Nur Ziffern, zum Beispiel 123.",
      });
      return;
    }
    if (!compared) {
      await check(studentId);
      return;
    }
    if (block !== null || linked) return;
    await link(studentId, compared);
  };

  const saveLabel = !compared
    ? "Prüfen"
    : onlyDiffers
      ? "Trotzdem verknüpfen"
      : "Verknüpfen";

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title="Mit Kinderakte verknüpfen"
      titleLevel={2}
      size="lg"
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={save.pending}
          savingLabel={compared ? "Wird verknüpft …" : "Wird geprüft …"}
          saveLabel={saveLabel}
          saveTooltip={
            !compared
              ? "Zeigt Vertrag und Kinderakte nebeneinander, verknüpft noch nichts."
              : onlyDiffers
                ? "Verknüpft den Vertrag sofort, obwohl die Angaben abweichen."
                : "Verknüpft den Vertrag sofort mit dieser Kinderakte."
          }
          disabled={compared !== null && (block !== null || linked)}
          disabledReason={
            linked
              ? "Der Vertrag ist schon mit dieser Kinderakte verknüpft."
              : "Mit dieser Nummer geht es nicht. Prüfe die Nummer oder gib eine andere ein."
          }
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          id="child-link-student"
          name={FIELD}
          label="Nummer der Kinderakte"
          required
          inputMode="numeric"
          autoComplete="off"
          value={number}
          onChange={(event) => {
            setNumber(event.target.value);
            formErrors.clear();
          }}
          hint="Öffne die Kinderakte im OGS-Portal der Schule. Die Zahl am Ende der Adresse ist die Nummer."
          error={formErrors.fieldError(FIELD)}
        />
        {compared ? (
          <>
            {/* What holds the link back comes first: on a phone the two
                sides fill the screen. */}
            {linked ? (
              <Alert
                type="info"
                message="Der Vertrag ist schon mit dieser Kinderakte verknüpft. Hier ist nichts zu tun."
              />
            ) : block !== null ? (
              <Alert
                type="warning"
                message={block}
                action={
                  compared.otherContractId ? (
                    <Link
                      href={traegerPath(
                        `/traeger/vertraege/${compared.otherContractId}`,
                      )}
                      target="_blank"
                      rel="noopener"
                      className="text-sm font-medium whitespace-nowrap underline"
                    >
                      Anderen Vertrag öffnen
                      <span className="sr-only">
                        {" "}
                        (öffnet in einem neuen Tab)
                      </span>
                    </Link>
                  ) : undefined
                }
              />
            ) : onlyDiffers ? (
              <Alert
                type="warning"
                title={childLinkDifferenceText(difference)}
                message="Verknüpfe nur, wenn beide Angaben sicher dasselbe Kind meinen. Vertrag und Kinderakte bleiben, wie sie sind."
              />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Side
                title="Im Vertrag steht"
                person={compared.contract}
                schoolName={compared.schoolName}
                difference={difference}
              />
              {compared.student ? (
                <Side
                  title="In der Kinderakte steht"
                  person={compared.student}
                  schoolName={compared.schoolName}
                  difference={difference}
                />
              ) : null}
            </div>
            {!linked && block === null && !onlyDiffers ? (
              <p className="text-sm text-gray-700">
                Name und Geburtsdatum passen. Eltern bekommen keine Nachricht.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-gray-600">
            moto zeigt dir danach Vertrag und Kinderakte nebeneinander. Erst
            dann verknüpfst du.
          </p>
        )}
      </form>
    </FormModal>
  );
}
