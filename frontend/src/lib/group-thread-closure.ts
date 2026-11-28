/**
 * Ob eine Gruppennachricht der OGS noch offen ist (#8213). Sie schließt,
 * wenn die OGS sie schließt oder wenn ihre Gruppe oder AG gelöscht wurde.
 * Im zweiten Fall bleibt `closed_at` leer und `closed_reason` nennt den Grund.
 */
import type { GroupThreadResponse } from "~/lib/contract/messages.generated";

export const GROUP_THREAD_GROUP_DELETED = "group_deleted";

type GroupThreadClosure = Readonly<
  Partial<Pick<GroupThreadResponse, "closed_at" | "closed_reason">>
>;

export function isGroupThreadClosed(thread: GroupThreadClosure): boolean {
  return Boolean(thread.closed_at) || Boolean(thread.closed_reason);
}

export function isGroupThreadGroupDeleted(thread: GroupThreadClosure): boolean {
  return thread.closed_reason === GROUP_THREAD_GROUP_DELETED;
}

/** Kurzer Zustand für Liste und Kopf: „Gruppe gelöscht“ oder „Geschlossen“. */
export function groupThreadClosedLabel(
  thread: GroupThreadClosure,
): string | null {
  if (isGroupThreadGroupDeleted(thread)) return "Gruppe gelöscht";
  return thread.closed_at ? "Geschlossen" : null;
}
