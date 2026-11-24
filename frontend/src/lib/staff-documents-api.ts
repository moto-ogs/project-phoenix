// Staff documents (#1424): API client + type mapping for the Dokumente tab
// on the staff detail page. The backend decides per-category authority
// (AU-Bescheinigung → staff_documents:health, Lohnabrechnung →
// staff:financial, rest → staff:documents, #2906) and returns only what the caller
// may see plus the caller's visible categories.

import { bffFileHref, bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type { StaffDocumentResponse } from "./contract/staff.generated";

export type StaffDocumentCategory =
  | "arbeitsvertrag"
  | "zeugnis"
  | "lohnabrechnung"
  | "bewerbung"
  | "au_bescheinigung"
  | "sonstiges";

export const staffDocumentCategoryLabels: Record<
  StaffDocumentCategory,
  string
> = {
  arbeitsvertrag: "Arbeitsvertrag",
  zeugnis: "Zeugnis / Qualifikation",
  lohnabrechnung: "Lohnabrechnung",
  bewerbung: "Bewerbungsunterlagen",
  au_bescheinigung: "AU-Bescheinigung",
  sonstiges: "Sonstiges",
};

export interface StaffDocument {
  id: string;
  staffId: string;
  category: StaffDocumentCategory;
  filename: string;
  sizeBytes: number;
  contentType: string;
  uploadedAt: string;
  /** "Aufbewahren bis" (YYYY-MM-DD) — advisory, nothing auto-deletes. */
  retainUntil: string | null;
  /** BDSG review date for Bewerbungsunterlagen (YYYY-MM-DD). */
  reviewDue: string | null;
}

export interface StaffDocumentList {
  documents: StaffDocument[];
  visibleCategories: StaffDocumentCategory[];
}

const CATEGORIES = Object.keys(
  staffDocumentCategoryLabels,
) as StaffDocumentCategory[];

/** A category this build does not know is shown as "Sonstiges". */
function category(value: string): StaffDocumentCategory {
  return knownEnum(CATEGORIES, value) ?? "sonstiges";
}

function mapDocument(data: StaffDocumentResponse): StaffDocument {
  return {
    id: data.id,
    staffId: data.staff_id,
    category: category(data.category),
    filename: data.filename,
    sizeBytes: data.size_bytes,
    contentType: data.content_type,
    uploadedAt: data.uploaded_at,
    retainUntil: data.retain_until ?? null,
    reviewDue: data.review_due ?? null,
  };
}

class StaffDocumentsService {
  async list(staffId: string): Promise<StaffDocumentList> {
    const list = await bffJson("tenant", "GET /api/staff/{id}/documents", {
      params: { id: staffId },
    });
    return {
      documents: (list.documents ?? []).map(mapDocument),
      visibleCategories: (list.visible_categories ?? []).flatMap(
        (value) => knownEnum(CATEGORIES, value) ?? [],
      ),
    };
  }

  async upload(
    staffId: string,
    file: File,
    category: StaffDocumentCategory,
  ): Promise<void> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);

    await bffJson("tenant", "POST /api/staff/{id}/documents", {
      params: { id: staffId },
      body: formData,
      errorMessage: "Failed to upload staff document",
    });
  }

  async delete(staffId: string, documentId: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/staff/{id}/documents/{documentId}", {
      params: { id: staffId, documentId },
      errorMessage: "Failed to delete staff document",
    });
  }

  /** Same-origin proxy URL for the authenticated download. */
  downloadUrl(staffId: string, documentId: string): string {
    return bffFileHref(
      "tenant",
      "GET /api/staff/{id}/documents/{documentId}/download",
      { params: { id: staffId, documentId } },
    );
  }
}

export const staffDocumentsService = new StaffDocumentsService();

/** Formats a byte count for display: "12 KB", "1,4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
