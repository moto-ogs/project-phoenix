import { knownEnum } from "./contract/known-enum";

/**
 * Every state of ADR 0088. The office reaches draft and sent; the conclusion
 * at the acceptance (#4680) or the signature (#4679) reaches active; a
 * termination or a withdrawal (#4682) ends an active contract.
 */
export type CareContractStatus = (typeof STATUS_VALUES)[number];

// Go does not register this set; the contract types it as string. Keep this
// shared mapper independent of either portal's API client.
const STATUS_VALUES = [
  "entwurf",
  "versendet",
  "aktiv",
  "gekuendigt",
  "widerrufen",
  "beendet",
] as const;

/** The status a value names, undefined for one this build does not know. */
export function knownContractStatus(
  value: string,
): CareContractStatus | undefined {
  return knownEnum(STATUS_VALUES, value);
}
