import type { Decoder } from "~/lib/contract/browser-runtime";
import type { ClassListImportResult } from "~/lib/contract/import.generated";
import type { ErrorCode } from "~/lib/error-codes.generated";

const importBatchFailedCode: ErrorCode = "import.import_batch_failed";
const abortingWriteCodes = new Set(["creation_failed", "update_failed"]);

interface ImportBatchRowError {
  row_number: number;
  errors?: ReadonlyArray<{ code?: string }> | null;
}

export interface ImportBatchResult<T = ImportBatchRowError> {
  total_rows: number;
  created_count: number;
  updated_count: number;
  error_count: number;
  errors: T[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function rowHasAbortingWrite(entry: ImportBatchRowError): boolean {
  return (entry.errors ?? []).some((error) =>
    abortingWriteCodes.has(error.code ?? ""),
  );
}

/**
 * Reads the committed import outcome from an `import.import_batch_failed` envelope.
 * Returns null for any other error so callers keep their generic failure path.
 * The importing route supplies the decoder for its row and summary types.
 */
export function readImportBatchFailure<T>(
  payload: unknown,
  schema: Pick<Decoder<T>, "safeParse">,
): T | null {
  if (!isRecord(payload) || payload.code !== importBatchFailedCode) {
    return null;
  }
  if (!isRecord(payload.details)) {
    return null;
  }
  const parsed = schema.safeParse(payload.details.result);
  return parsed.success ? parsed.data : null;
}

/**
 * Reads the refusal that stopped a batch, such as a full Kinderkontingent
 * (#3571): `{ code, details }` in `details.rejection` of an
 * `import.import_batch_failed` envelope. Null when a batch failed for another reason.
 */
export function readImportBatchRejection(payload: unknown): unknown {
  if (!isRecord(payload) || payload.code !== importBatchFailedCode) {
    return null;
  }
  if (!isRecord(payload.details) || !isRecord(payload.details.rejection)) {
    return null;
  }
  return payload.details.rejection;
}

export function importBatchSavedCount(
  result: Pick<ClassListImportResult, "created_count" | "updated_count">,
): number {
  return result.created_count + result.updated_count;
}

/** Create-mode preview records already-written rows as already_exists, not as remaining work. */
export function countAlreadyExistsRows(
  rows:
    | ReadonlyArray<{ errors: ReadonlyArray<{ code: string }> | null }>
    | null
    | undefined,
): number {
  return (rows ?? []).filter((row) =>
    (row.errors ?? []).some((error) => error.code === "already_exists"),
  ).length;
}

function importBatchBlockingRow(result: ImportBatchResult): number | undefined {
  const errors = result.errors ?? [];
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    const row = errors[index];
    if (row && row.row_number > 0 && rowHasAbortingWrite(row)) {
      return row.row_number;
    }
  }
  return undefined;
}

function savedRowsSentence(saved: number): string {
  return saved === 1
    ? "1 Zeile ist gespeichert."
    : `${saved} Zeilen sind gespeichert.`;
}

/**
 * Persistent alert copy: saved rows first, then the blocking row and next
 * step. A refusal (already worded for the reader) replaces the blocking row:
 * the batch stopped as a whole, not at one row.
 */
export function importBatchFailureMessage(
  result: ImportBatchResult,
  refusal?: string | null,
): string {
  const saved = importBatchSavedCount(result);
  if (refusal) {
    if (saved === 0) return refusal;
    return `${savedRowsSentence(saved)} ${refusal} Die gespeicherten Zeilen bleiben.`;
  }
  const blockingRow = importBatchBlockingRow(result);
  if (saved === 0) {
    if (blockingRow === undefined) {
      return "Der Import hat nicht geklappt. Bitte prüfe die Datei. Lade sie danach erneut hoch.";
    }
    return `Zeile ${blockingRow} hat nicht geklappt. Bitte korrigiere diese Zeile. Lade die Datei danach erneut hoch.`;
  }
  const savedSentence = savedRowsSentence(saved);
  if (blockingRow === undefined) {
    return `${savedSentence} Der Rest hat nicht geklappt. Lade die Datei danach erneut hoch. Die gespeicherten Zeilen bleiben.`;
  }
  return `${savedSentence} Zeile ${blockingRow} hat den Rest angehalten. Bitte korrigiere diese Zeile. Lade die Datei danach erneut hoch. Die gespeicherten Zeilen bleiben.`;
}
