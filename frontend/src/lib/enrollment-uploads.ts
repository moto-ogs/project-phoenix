import { bffJson } from "~/lib/bff-fetch";
import type * as sharedContract from "~/lib/contract/shared.generated";

/** File kinds a `file` form field may accept (backend FileType*). */
export type EnrollmentFileType = "pdf" | "jpg" | "png";

/** Per-field rules of a `file` form field (#4783). */
export type FileFieldOptions = Omit<
  sharedContract.FormFileOptions,
  "allowed_types" | "multiple"
> & {
  allowed_types: EnrollmentFileType[];
  multiple: boolean;
};

export const ENROLLMENT_FILE_TYPES: readonly EnrollmentFileType[] = [
  "pdf",
  "jpg",
  "png",
];

/** Backend limits: 1..10 MB per file, at most 5 files on a multiple field. */
export const MIN_UPLOAD_MB = 1;
export const MAX_UPLOAD_MB = 10;
export const MAX_FILES_PER_FIELD = 5;

export const FILE_TYPE_MIME: Record<EnrollmentFileType, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
};

export const FILE_TYPE_LABEL: Record<EnrollmentFileType, string> = {
  pdf: "PDF",
  jpg: "JPG",
  png: "PNG",
};

export function defaultFileFieldOptions(): FileFieldOptions {
  return {
    allowed_types: [...ENROLLMENT_FILE_TYPES],
    max_size_mb: MAX_UPLOAD_MB,
    multiple: false,
  };
}

/**
 * The options a field actually carries, clamped to what the backend accepts.
 * An old or hand-edited schema without options falls back to the defaults.
 */
export function effectiveFileFieldOptions(
  options: Partial<FileFieldOptions> | null | undefined,
): FileFieldOptions {
  const defaults = defaultFileFieldOptions();
  const allowed = (options?.allowed_types ?? []).filter((type) =>
    ENROLLMENT_FILE_TYPES.includes(type),
  );
  const size = Math.round(Number(options?.max_size_mb));
  return {
    allowed_types:
      allowed.length > 0
        ? ENROLLMENT_FILE_TYPES.filter((type) => allowed.includes(type))
        : defaults.allowed_types,
    max_size_mb: Number.isFinite(size)
      ? Math.min(MAX_UPLOAD_MB, Math.max(MIN_UPLOAD_MB, size))
      : defaults.max_size_mb,
    multiple: options?.multiple === true,
  };
}

export function maxFilesFor(options: FileFieldOptions): number {
  return options.multiple ? MAX_FILES_PER_FIELD : 1;
}

/** `accept` for the file input; MIME types let phones offer the camera. */
export function acceptFor(options: FileFieldOptions): string {
  return options.allowed_types.map((type) => FILE_TYPE_MIME[type]).join(",");
}

/**
 * A file stored with an earlier submission (status-token edit). The answers
 * of a form travel in `custom_data`, which the contract carries as unknown;
 * this is the shape the backend writes there.
 */
interface StoredUploadValue {
  upload_id: string;
  filename: string;
  size_bytes: number;
  content_type: string;
}

/**
 * A file field's answer entry: a file uploaded in this form session, claimed
 * by its receipt's token on submit, or one stored before.
 */
export type UploadValue = sharedContract.UploadReceipt | StoredUploadValue;

/** Stable identity of one entry for list keys and removal. */
export function uploadValueKey(value: UploadValue): string {
  return "token" in value ? `token:${value.token}` : `id:${value.upload_id}`;
}

/**
 * The entries of a file field's answer. Anything that is not a well-formed
 * new or stored upload is dropped, so a stale or foreign value never travels
 * back to the backend.
 */
export function asUploadValues(value: unknown): UploadValue[] {
  if (!Array.isArray(value)) return [];
  const out: UploadValue[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const filename = typeof raw.filename === "string" ? raw.filename : "";
    const size = typeof raw.size_bytes === "number" ? raw.size_bytes : 0;
    const contentType =
      typeof raw.content_type === "string" ? raw.content_type : "";
    if (typeof raw.token === "string" && raw.token !== "") {
      out.push({
        token: raw.token,
        filename,
        size_bytes: size,
        content_type: contentType,
      });
    } else if (
      (typeof raw.upload_id === "string" && raw.upload_id !== "") ||
      typeof raw.upload_id === "number"
    ) {
      out.push({
        upload_id: String(raw.upload_id),
        filename,
        size_bytes: size,
        content_type: contentType,
      });
    }
  }
  return out;
}

/** True when a value looks like a file field answer (admin display). */
export function isUploadValueList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).filename === "string" &&
        ("upload_id" in entry || "token" in entry),
    )
  );
}

/** "820 KB", "1,4 MB" in the reader's language. */
export function formatUploadSize(bytes: number, locale = "de"): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < 1024 * 1024) {
    const kb = Math.max(1, Math.round(safe / 1024));
    return `${new Intl.NumberFormat(locale).format(kb)} KB`;
  }
  const mb = safe / (1024 * 1024);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
}

/** The message of a failed upload; the user reads the catalog text. */
export const UPLOAD_FAILED = "Datei konnte nicht hochgeladen werden";

/**
 * Uploads one file for a `file` field of the enrollment form. The public
 * route is anonymous like the submit; a signed-in parent uploads through the
 * parents portal (`viaParentPortal`). The answer's token is single-use and
 * claimed by the submission.
 */
export async function uploadEnrollmentFile(params: {
  tenantSlug: string;
  phaseId: string;
  fieldKey: string;
  file: File;
  lateInviteToken?: string;
  statusToken?: string;
  viaParentPortal?: boolean;
  signal?: AbortSignal;
}): Promise<sharedContract.UploadReceipt> {
  // The upload endpoint verifies the same authorization context as the form:
  // public/late-invite submission or a status-link edit.
  const body = new FormData();
  body.append("phase_id", params.phaseId);
  body.append("field_key", params.fieldKey);
  if (params.lateInviteToken?.trim()) {
    body.append("late_invite_token", params.lateInviteToken.trim());
  }
  if (params.statusToken?.trim()) {
    body.append("status_token", params.statusToken.trim());
  }
  body.append("file", params.file);
  const options = {
    params: { tenantSlug: params.tenantSlug },
    body,
    ...(params.signal && { signal: params.signal }),
    errorMessage: UPLOAD_FAILED,
  };
  return params.viaParentPortal
    ? bffJson(
        "parent",
        "POST /parent/enrollments/{tenantSlug}/uploads",
        options,
      )
    : bffJson("public", "POST /api/enrollment/{tenantSlug}/uploads", options);
}

/** Address of the staff download proxy for one stored upload. */
export function adminUploadHref(requestId: string, uploadId: string): string {
  return `/api/enrollment/admin/requests/${encodeURIComponent(
    requestId,
  )}/uploads/${encodeURIComponent(uploadId)}`;
}
