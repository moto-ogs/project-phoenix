// Accident reports (Unfallanzeige, #4771): the recorded accident of a child.
// A report is a child document of the category „Unfallanzeige“; the list
// arrives with the documents (`student-documents-api`). This client writes
// reports and names the PDF. The backend decides every permission
// (student_accidents:read / :manage) and refuses changes to a signed report.

import type { AccidentReportResponse } from "~/lib/contract/students.generated";
import { bffFileHref, bffJson } from "./bff-fetch";
import { signatureRequestBody, type SignatureValue } from "./signature";

type AccidentReportStatus = "open" | "signed";

/** What the team records, in the fields of the official form. */
export interface AccidentReportFields {
  /** Instant of the accident, ISO 8601. */
  occurredAt: string;
  location: string;
  description: string;
  injuredBodyParts: string;
  injuryKind: string;
  witnesses: string;
  firstAid: string;
  doctorVisited: boolean;
  doctor: string;
  parentsNotified: string;
  /** Instant the parents were told, ISO 8601, or null. */
  parentsNotifiedAt: string | null;
  supervisor: string;
}

export interface AccidentReportDetails extends AccidentReportFields {
  status: AccidentReportStatus;
  /** 1 for the first report, one more per correction; 0 when unknown. */
  version: number;
  supersedesId: string | null;
  supersededById: string | null;
  signedAt: string | null;
  signedDigitally: boolean;
}

export function mapAccidentReport(
  data: AccidentReportResponse,
): AccidentReportDetails {
  return {
    status: data.status === "signed" ? "signed" : "open",
    version: data.version ?? 0,
    supersedesId: data.supersedes_id ?? null,
    supersededById: data.superseded_by_id ?? null,
    signedAt: data.signed_at ?? null,
    signedDigitally: data.signed_digitally,
    occurredAt: data.occurred_at,
    location: data.location,
    description: data.description,
    injuredBodyParts: data.injured_body_parts,
    injuryKind: data.injury_kind,
    witnesses: data.witnesses,
    firstAid: data.first_aid,
    doctorVisited: data.doctor_visited,
    doctor: data.doctor,
    parentsNotified: data.parents_notified,
    parentsNotifiedAt: data.parents_notified_at ?? null,
    supervisor: data.supervisor,
  };
}

function requestBody(fields: AccidentReportFields) {
  return {
    occurred_at: fields.occurredAt,
    location: fields.location,
    description: fields.description,
    injured_body_parts: fields.injuredBodyParts,
    injury_kind: fields.injuryKind,
    witnesses: fields.witnesses,
    first_aid: fields.firstAid,
    doctor_visited: fields.doctorVisited,
    doctor: fields.doctorVisited ? fields.doctor : "",
    parents_notified: fields.parentsNotified,
    parents_notified_at: fields.parentsNotified
      ? fields.parentsNotifiedAt
      : null,
    supervisor: fields.supervisor,
  };
}

/** The page of one accident report in the tenant portal. */
export function accidentReportPath(studentId: string, reportId: string) {
  return `/students/${studentId}/unfallanzeigen/${reportId}`;
}

class StudentAccidentReportsService {
  /** Records a new open report and returns its id. */
  async create(
    studentId: string,
    fields: AccidentReportFields,
  ): Promise<string> {
    const report = await bffJson(
      "tenant",
      "POST /api/students/{id}/accident-reports",
      {
        params: { id: studentId },
        body: requestBody(fields),
      },
    );
    return report.id;
  }

  /**
   * Changes an open report. `expectedVersion` is the version of the report
   * the change was made on; the backend refuses the change with
   * `general.changed_since_read` when the report changed since (ADR 0311).
   */
  async update(
    studentId: string,
    reportIdValue: string,
    fields: AccidentReportFields,
    expectedVersion: string,
  ): Promise<void> {
    await bffJson(
      "tenant",
      "PUT /api/students/{id}/accident-reports/{documentId}",
      {
        params: { id: studentId, documentId: reportIdValue },
        body: { ...requestBody(fields), expected_version: expectedVersion },
      },
    );
  }

  /** Records a new version of a signed report and returns its id. */
  async correct(
    studentId: string,
    reportIdValue: string,
    fields: AccidentReportFields,
  ): Promise<string> {
    const report = await bffJson(
      "tenant",
      "POST /api/students/{id}/accident-reports/{documentId}/corrections",
      {
        params: { id: studentId, documentId: reportIdValue },
        body: requestBody(fields),
      },
    );
    return report.id;
  }

  /** Signs the report as read at `expectedVersion`. */
  async sign(
    studentId: string,
    reportIdValue: string,
    signature: SignatureValue,
    expectedVersion: string,
  ): Promise<void> {
    await bffJson(
      "tenant",
      "POST /api/students/{id}/accident-reports/{documentId}/signature",
      {
        params: { id: studentId, documentId: reportIdValue },
        body: {
          ...signatureRequestBody(signature),
          expected_version: expectedVersion,
        },
      },
    );
  }

  /** Signs the report as read at `expectedVersion` with its paper copy. */
  async uploadPaperCopy(
    studentId: string,
    reportIdValue: string,
    file: File,
    expectedVersion: string,
  ): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("expected_version", expectedVersion);
    await bffJson(
      "tenant",
      "POST /api/students/{id}/accident-reports/{documentId}/paper-copy",
      { params: { id: studentId, documentId: reportIdValue }, body: formData },
    );
  }

  /** Same-origin proxy URL of the report as PDF. */
  pdfUrl(studentId: string, reportIdValue: string): string {
    return bffFileHref(
      "tenant",
      "GET /api/students/{id}/accident-reports/{documentId}/pdf",
      { params: { id: studentId, documentId: reportIdValue } },
    );
  }
}

export const studentAccidentReportsService =
  new StudentAccidentReportsService();
