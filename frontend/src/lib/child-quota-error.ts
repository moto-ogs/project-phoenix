import type { ErrorCode } from "~/lib/error-codes.generated";
import { readCodedApiError } from "./coded-api-error";
import { ChildQuotaDetailsSchema } from "./contract/problem-details.generated";

/**
 * Fehlercode, wenn das Kinderkontingent einer OGS erreicht ist (#3567). Der
 * Code ist die Identität des Fehlers; der Backend-Text ist nur Diagnose.
 */
export const CHILD_QUOTA_REACHED_CODE =
  "students.child_quota_reached" satisfies ErrorCode;

/**
 * Meldung für ein erreichtes Kinderkontingent, sonst null. Die Zahlen kommen
 * aus den Details der Antwort; fehlen sie, bleibt der Satz ohne Zahlen.
 */
export function childQuotaMessage(err: unknown): string | null {
  const coded = readCodedApiError(err);
  if (coded?.code !== CHILD_QUOTA_REACHED_CODE) return null;
  const decoded = ChildQuotaDetailsSchema.safeParse(coded.details);
  const stand = decoded.success
    ? ` Die Kontingentzahl beträgt ${decoded.data.occupied_places} von ${decoded.data.booked_places} Kindern.`
    : "";
  return `Das Kinderkontingent deiner Schule ist voll.${stand} Für weitere Kinder melde dich bitte beim moto-Team.`;
}
