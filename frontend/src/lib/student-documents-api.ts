// Child documents (#777): API client + type mapping for the Dokumente tab on
// the child detail page. The backend decides per-category authority (Attest,
// Impfnachweis, Medikamentenplan → student_documents:health, Sorgerecht →
// student_documents:legal, rest → users:update) and returns only what the
// caller may see plus the caller's visible categories.

import type * as wire from "~/lib/contract/students.generated";
import { bffJson } from "./bff-fetch";
import {
  mapAccidentReport,
  type AccidentReportDetails,
} from "./student-accident-reports-api";

interface StudentDocumentCategoryOption {
  value: string;
  label: string;
  /** Health or custody paperwork: every download is logged. */
  sensitive: boolean;
}

export interface StudentDocument {
  id: string;
  studentId: string;
  category: string;
  categoryLabel: string;
  filename: string;
  sizeBytes: number;
  contentType: string;
  uploadedAt: string;
  sensitive: boolean;
  /** False for an accident report without a paper copy (#4771). */
  hasFile: boolean;
  accidentReport: AccidentReportDetails | null;
}

export interface StudentDocumentList {
  documents: StudentDocument[];
  visibleCategories: StudentDocumentCategoryOption[];
}

function mapDocument(data: wire.StudentDocumentResponse): StudentDocument {
  return {
    id: data.id,
    studentId: data.student_id,
    category: data.category,
    categoryLabel: data.category_label,
    filename: data.filename,
    sizeBytes: data.size_bytes,
    contentType: data.content_type,
    uploadedAt: data.uploaded_at,
    sensitive: data.sensitive,
    hasFile: data.has_file,
    accidentReport: data.accident_report
      ? mapAccidentReport(data.accident_report)
      : null,
  };
}

function documentsPath(studentId: string, documentId: string): string {
  return `/api/students/${encodeURIComponent(studentId)}/documents/${encodeURIComponent(documentId)}`;
}

class StudentDocumentsService {
  async list(studentId: string): Promise<StudentDocumentList> {
    const list = await bffJson("tenant", "GET /api/students/{id}/documents", {
      params: { id: studentId },
    });
    return {
      documents: (list.documents ?? []).map(mapDocument),
      visibleCategories: list.visible_categories ?? [],
    };
  }

  async upload(studentId: string, file: File, category: string): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    await bffJson("tenant", "POST /api/students/{id}/documents", {
      params: { id: studentId },
      body: formData,
    });
  }

  async delete(studentId: string, documentId: string): Promise<void> {
    await bffJson(
      "tenant",
      "DELETE /api/students/{id}/documents/{documentId}",
      {
        params: { id: studentId, documentId },
      },
    );
  }

  /** Same-origin proxy URL for the authenticated download. */
  downloadUrl(studentId: string, documentId: string): string {
    return `${documentsPath(studentId, documentId)}/download`;
  }
}

export const studentDocumentsService = new StudentDocumentsService();
