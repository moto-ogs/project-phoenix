"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AccidentReportCreateModal } from "~/components/students/accident-report-create-modal";
import {
  AccidentReportFormFields,
  accidentReportDraftErrors,
  draftFromReport,
  fieldsFromDraft,
  type AccidentReportDraft,
} from "~/components/students/accident-report-form";
import { ActionHint } from "~/components/ui/action-hint";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink, buttonClassName } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import type { FormErrorInput } from "~/components/ui/form-error";
import { SectionCard } from "~/components/ui/section-card";
import {
  SignaturePad,
  type SignatureValue,
} from "~/components/ui/signature-pad";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useApiFormError, useApiLoadError } from "~/contexts/ToastContext";
import { isReadStateRefusal } from "~/lib/api-error";
import { useReadDraftLoadError } from "~/lib/hooks/use-swr-load-error";
import { fetchStudent } from "~/lib/student-api";
import { useStudentHistoryBreadcrumb } from "~/lib/breadcrumb-context";
import { hasPermission } from "~/lib/auth-utils";
import { berlinClockFromISO, formatBerlinDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  accidentReportPath,
  studentAccidentReportsService,
  type AccidentReportDetails,
} from "~/lib/student-accident-reports-api";
import {
  studentDocumentsService,
  type StudentDocument,
  type StudentDocumentList,
} from "~/lib/student-documents-api";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import { useDraftOn, type ReadDraft } from "~/lib/swr/read-draft";
import { studentKeys } from "~/lib/swr/portal-keys";

const ACCIDENT_REPORT_INFO =
  "Hier steht die Unfallanzeige zu einem Unfall dieses Kindes. Unterschrieben wird sie unter „Unterschrift der Leitung“. Danach gibst du das PDF selbst an die Unfallkasse weiter.";

// Unfallanzeige (#4771): one accident report of a child. The page shows what
// was recorded, lets the leadership sign it (drawn signature or the signed
// paper copy) and offers the PDF in the layout of the official form. A signed
// report never changes again; „Korrektur anlegen“ records a new version.

const logger = createLogger({ component: "AccidentReportPage" });

function stamp(iso: string | null): string {
  if (!iso) return "–";
  return `${formatBerlinDate(iso)}, ${berlinClockFromISO(iso)} Uhr`;
}

/** The child's name for the head and the breadcrumb; null until known. */
function useStudentName(studentId: string): string | null {
  const { data } = useSWRAuth<string | null>(
    studentKeys.name(studentId),
    // The name only labels the page; without it the report still shows.
    () =>
      fetchStudent(studentId).then(
        (student) => student.name,
        () => null,
      ),
  );
  return data ?? null;
}

function findReport(
  list: StudentDocumentList | undefined,
  reportId: string,
): StudentDocument | undefined {
  return list?.documents.find(
    (doc) => doc.id === reportId && doc.accidentReport,
  );
}

function orDash(value: string): string {
  return value.trim() ? value : "–";
}

export default function AccidentReportPage() {
  const params = useParams();
  const studentId = params.id as string;
  const reportId = params.reportId as string;
  const { data: session } = useSession();
  const canManage = hasPermission(session, "student_accidents:manage");

  const documents = useSWRAuth<StudentDocumentList>(
    studentKeys.documents(studentId),
    () => studentDocumentsService.list(studentId),
  );
  const { data, isLoading, error, mutate } = documents;
  // A refusal reads the stored report again; this read rejects when it
  // fails, SWR's own `mutate()` would resolve with the old list (ADR 0311).
  const documentsRef = useRef(documents);
  useLayoutEffect(() => {
    documentsRef.current = documents;
  });
  const reloadReport = useCallback(
    async () =>
      findReport(await revalidateOrThrow(documentsRef.current), reportId),
    [reportId],
  );
  const load = useApiLoadError();
  const showLoadError = load.show;
  const clearLoadError = load.clear;
  useEffect(() => {
    if (error) {
      void showLoadError(error, {
        object: "die Unfallanzeige",
        retry: () => void mutate(),
      });
    } else {
      clearLoadError();
    }
  }, [error, mutate, showLoadError, clearLoadError]);

  const document = findReport(data, reportId);
  const report = document?.accidentReport ?? null;
  const backHref = `/students/${studentId}?tab=dokumente`;
  const studentName = useStudentName(studentId);
  useStudentHistoryBreadcrumb({
    studentName: studentName ?? undefined,
    referrer: "/students/search",
  });

  // The change is a draft on the report as it was when „Ändern“ opened it;
  // the save sends that version, a refusal shows the stored report again
  // (ADR 0311).
  const [editing, setEditing] = useState(false);
  const editFormRef = useRef<HTMLFormElement>(null);
  const editErrors = useApiFormError(editFormRef);
  const reportDraft = useDraftOn<
    StudentDocument,
    AccidentReportDraft,
    string,
    void
  >(
    {
      opening: editing ? reportId : null,
      data: document,
      reload: reloadReport,
    },
    {
      token: (doc) => doc.version ?? "",
      toDraft: (doc) =>
        draftFromReport(doc.accidentReport as AccidentReportDetails),
    },
  );
  // Signed by someone else while this page edited it: once the draft holds
  // nothing typed (after the refusal's reload, or an untouched draft), the
  // edit state ends and „Korrektur anlegen“ is offered. Typed input is never
  // dropped silently; its save is refused and the reload ends the edit then.
  // The refusal's message lives here, so it outlasts the form it came from.
  if (editing && report && report.status !== "open" && !reportDraft.touched) {
    setEditing(false);
  }
  const [correcting, setCorrecting] = useState(false);

  return (
    <TenantPage
      title={
        report?.supersedesId ? "Unfallanzeige (Korrektur)" : "Unfallanzeige"
      }
      info={ACCIDENT_REPORT_INFO}
      back
      backHref={backHref}
      backLabel="Zurück zum Kinderprofil"
      loading={isLoading}
      error={
        load.error ??
        (data && !report
          ? "Diese Unfallanzeige gibt es nicht mehr. Du findest alle Unfallanzeigen im Kinderprofil unter Dokumente."
          : null)
      }
      stats={
        report ? (
          <TenantPageStats
            items={[
              ...(studentName ? [{ value: studentName, label: "" }] : []),
              { value: stamp(report.occurredAt), label: "Unfall" },
            ]}
          />
        ) : undefined
      }
      actions={
        report ? (
          // A download, not a page: a plain anchor in the kit's button look.
          <ActionHint text="Speichert die Unfallanzeige als PDF auf deinem Gerät.">
            <a
              href={studentAccidentReportsService.pdfUrl(studentId, reportId)}
              // Kennzeichen der Kopfkarte für ihre Bedienhöhe (wie `ButtonLink`).
              data-button-link=""
              className={buttonClassName({
                variant: "outline",
                size: "md",
                className: "",
              })}
            >
              PDF herunterladen
            </a>
          </ActionHint>
        ) : undefined
      }
      overlays={
        report && canManage && report.status === "signed" ? (
          <AccidentReportCreateModal
            key={reportId}
            isOpen={correcting}
            onClose={() => setCorrecting(false)}
            studentId={studentId}
            correctsReportId={reportId}
            initialDraft={draftFromReport(report)}
            onCreated={() => {
              setCorrecting(false);
              void mutate();
            }}
            openCreated
          />
        ) : undefined
      }
    >
      {report && document && (
        <div className="space-y-6">
          {report.supersededById && (
            <Alert
              type="info"
              message="Zu dieser Unfallanzeige gibt es eine Korrektur. Diese Fassung bleibt unverändert erhalten."
              action={
                <ButtonLink
                  href={accidentReportPath(studentId, report.supersededById)}
                  variant="outline"
                  size="compact"
                  tooltip="Öffnet die korrigierte, neuere Fassung dieser Unfallanzeige."
                >
                  Korrektur öffnen
                </ButtonLink>
              }
            />
          )}
          <SignatureSection
            studentId={studentId}
            reportId={reportId}
            document={document}
            report={report}
            canManage={canManage && !editing}
            onSigned={() => void mutate()}
            reload={reloadReport}
            onCorrect={() => setCorrecting(true)}
          />
          {editing && report.status === "open" ? (
            <EditReportSection
              studentId={studentId}
              reportId={reportId}
              reportDraft={reportDraft}
              formRef={editFormRef}
              formError={editErrors}
              onDone={() => {
                setEditing(false);
                void mutate();
              }}
              onCancel={() => {
                editErrors.clear();
                setEditing(false);
              }}
            />
          ) : (
            <ReportDetails
              report={report}
              error={editErrors.error}
              onEdit={
                canManage && report.status === "open"
                  ? () => {
                      editErrors.clear();
                      setEditing(true);
                    }
                  : undefined
              }
            />
          )}
        </div>
      )}
    </TenantPage>
  );
}

function ReportDetails({
  report,
  error,
  onEdit,
}: Readonly<{
  report: AccidentReportDetails;
  /** A refused change whose edit state has ended (signed meanwhile). */
  error: FormErrorInput;
  onEdit?: () => void;
}>) {
  return (
    <SectionCard
      title="Angaben zum Unfall"
      description="Die Angaben folgen dem Vordruck der Unfallkasse."
      action={
        onEdit ? (
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onEdit}
            tooltip="Öffnet die Angaben zum Unfall zum Ändern."
          >
            Ändern
          </Button>
        ) : undefined
      }
    >
      <FormErrorAlert message={error} />
      <DataGrid>
        <DataField label="Unfallzeitpunkt">
          {stamp(report.occurredAt)}
        </DataField>
        <DataField label="Unfallort">{report.location}</DataField>
        <DataField label="Was ist passiert?" fullWidth>
          <span className="whitespace-pre-line">{report.description}</span>
        </DataField>
        <DataField label="Verletzte Körperteile">
          {orDash(report.injuredBodyParts)}
        </DataField>
        <DataField label="Art der Verletzung">{report.injuryKind}</DataField>
        <DataField label="Erste Hilfe">{orDash(report.firstAid)}</DataField>
        <DataField label="Arzt oder Krankenhaus">
          {report.doctorVisited ? report.doctor : "Kein Arztbesuch"}
        </DataField>
        <DataField label="Zeugen">{orDash(report.witnesses)}</DataField>
        <DataField label="Benachrichtigte Eltern">
          {report.parentsNotified
            ? `${report.parentsNotified}${
                report.parentsNotifiedAt
                  ? `, ${stamp(report.parentsNotifiedAt)}`
                  : ""
              }`
            : "Noch nicht benachrichtigt"}
        </DataField>
        <DataField label="Aufsichtsperson">{report.supervisor}</DataField>
      </DataGrid>
    </SectionCard>
  );
}

function EditReportSection({
  studentId,
  reportId,
  reportDraft,
  formRef,
  formError,
  onDone,
  onCancel,
}: Readonly<{
  studentId: string;
  reportId: string;
  reportDraft: ReadDraft<StudentDocument, AccidentReportDraft, string, void>;
  formRef: RefObject<HTMLFormElement | null>;
  /** The page's, so a refusal that ends the edit state stays on screen. */
  formError: ReturnType<typeof useApiFormError>;
  onDone: () => void;
  onCancel: () => void;
}>) {
  const [saving, setSaving] = useState(false);
  const loadError = useReadDraftLoadError(reportDraft, "die Unfallanzeige");
  const draft = reportDraft.draft;

  const save = async () => {
    // Enter submits past the blocked button: nothing goes out before the
    // stored report is read, and the shown error stays (ADR 0311).
    if (!draft || !reportDraft.canSubmit) return;
    const errors = accidentReportDraftErrors(draft);
    if (Object.keys(errors).length > 0) {
      formError.invalid("Bitte fülle die markierten Felder aus.", errors);
      return;
    }
    setSaving(true);
    formError.clear();
    const result = await reportDraft.submit((version, current) =>
      studentAccidentReportsService.update(
        studentId,
        reportId,
        fieldsFromDraft(current),
        version,
      ),
    );
    setSaving(false);
    if (result.ok) {
      onDone();
      return;
    }
    logger.error("accident_report_update_failed", {
      student_id: studentId,
      report_id: reportId,
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    });
    // After a refusal the form holds the stored report; the message waits
    // for that read and names a failed one instead.
    await formError.show(result.error, {
      object: "die Unfallanzeige",
      reload: result.reload,
    });
  };

  return (
    <SectionCard title="Angaben zum Unfall">
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        {loadError ? <LoadErrorAlert error={loadError} /> : null}
        <FormErrorAlert message={formError.error} />
        {draft ? (
          <AccidentReportFormFields
            draft={draft}
            onChange={reportDraft.setDraft}
            fieldError={formError.fieldError}
            disabled={saving}
          />
        ) : null}
        <EditActions
          onCancel={onCancel}
          saving={saving}
          saveType="submit"
          disabled={!reportDraft.canSubmit}
          disabledReason="Der gespeicherte Stand der Unfallanzeige wird zuerst geladen."
        />
      </form>
    </SectionCard>
  );
}

function SignatureSection({
  studentId,
  reportId,
  document,
  report,
  canManage,
  onSigned,
  reload,
  onCorrect,
}: Readonly<{
  studentId: string;
  reportId: string;
  document: StudentDocument;
  report: AccidentReportDetails;
  canManage: boolean;
  onSigned: () => void;
  /** Reads the stored report again; rejects when that read fails. */
  reload: () => Promise<unknown>;
  onCorrect: () => void;
}>) {
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const formError = useApiFormError(sectionRef);

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    formError.clear();
    try {
      await action();
      setSignature(null);
      onSigned();
    } catch (err) {
      logger.error(failure, {
        student_id: studentId,
        report_id: reportId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Refused because the report changed since it was read: the signature
      // is dropped and the stored report shows, to be read and signed again.
      // The message waits for that read (ADR 0311).
      if (isReadStateRefusal(err)) setSignature(null);
      await formError.show(err, { object: "die Unterschrift", reload });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (report.status === "signed") {
    return (
      <SectionCard
        title="Unterschrift der Leitung"
        action={
          canManage && !report.supersededById ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onCorrect}
              tooltip="Öffnet eine Kopie zum Ändern, die bisherige Fassung bleibt erhalten."
            >
              Korrektur anlegen
            </Button>
          ) : undefined
        }
      >
        {/* A signature refused because someone else signed first. */}
        <FormErrorAlert message={formError.error} />
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone="green" label="Unterschrieben" />
          <span className="text-sm text-gray-700">
            {report.signedDigitally
              ? `Digital unterschrieben am ${stamp(report.signedAt)}.`
              : `Papierexemplar hochgeladen am ${stamp(report.signedAt)}.`}
          </span>
          {document.hasFile && (
            <ActionHint text="Speichert das unterschriebene Papierexemplar auf deinem Gerät.">
              <a
                href={studentDocumentsService.downloadUrl(studentId, reportId)}
                className={buttonClassName({
                  variant: "outline",
                  size: "md",
                  className: "",
                })}
              >
                Papierexemplar herunterladen
              </a>
            </ActionHint>
          )}
        </div>
        <p className="mt-3 text-sm text-gray-600">
          Die Unfallanzeige lässt sich nicht mehr ändern. Bei einem Fehler legst
          du eine Korrektur an.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Unterschrift der Leitung"
      description={
        canManage
          ? "Die Leitung unterschreibt die Unfallanzeige. Danach lässt sie sich nicht mehr ändern."
          : "Die Leitung unterschreibt die Unfallanzeige."
      }
    >
      <div ref={sectionRef} className="space-y-4">
        <div className="flex items-center gap-3">
          <StatusBadge tone="warning" label="Offen" />
          <span className="text-sm text-gray-700">
            Noch nicht unterschrieben.
          </span>
        </div>
        <FormErrorAlert message={formError.error} />
        {canManage && (
          <>
            <SignaturePad
              id="unfall-unterschrift"
              value={signature}
              onChange={setSignature}
              disabled={busy}
            />
            {/* Shown once the pad holds a confirmed signature, so the pad's
                own confirm button is the only primary action before that. */}
            {signature && (
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={busy}
                tooltip="Unterschreibt die Unfallanzeige sofort, danach lässt sie sich nicht mehr ändern."
                onClick={() => {
                  void run(
                    () =>
                      studentAccidentReportsService.sign(
                        studentId,
                        reportId,
                        signature,
                        document.version ?? "",
                      ),
                    "accident_report_sign_failed",
                  );
                }}
              >
                {busy ? "Wird gespeichert…" : "Unterschreiben"}
              </Button>
            )}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-600">
                Oder: Drucke das PDF aus, lass es unterschreiben und lade es
                hier hoch.
              </p>
              <Button
                type="button"
                variant="outline"
                size="md"
                className="mt-3"
                disabled={busy}
                tooltip="Öffnet die Dateiauswahl, danach gilt die Anzeige sofort als unterschrieben."
                onClick={() => fileRef.current?.click()}
              >
                Unterschriebenes Papierexemplar hochladen
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                aria-label="Unterschriebenes Papierexemplar auswählen"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void run(
                    () =>
                      studentAccidentReportsService.uploadPaperCopy(
                        studentId,
                        reportId,
                        file,
                        document.version ?? "",
                      ),
                    "accident_report_paper_upload_failed",
                  );
                }}
              />
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
