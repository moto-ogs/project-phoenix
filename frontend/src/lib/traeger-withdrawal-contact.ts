import type {
  TraegerContact,
  TraegerWithdrawalContact,
} from "~/lib/traeger-api";

/** Where a value of the withdrawal notice comes from (#6200). */
export type WithdrawalReachSource = "own" | "contact" | "missing";

export interface WithdrawalReachValue {
  readonly value: string;
  readonly source: WithdrawalReachSource;
}

export interface WithdrawalReach {
  readonly phone: WithdrawalReachValue;
  readonly email: WithdrawalReachValue;
}

function pick(own: string, contact: string): WithdrawalReachValue {
  if (own.trim() !== "") return { value: own.trim(), source: "own" };
  if (contact.trim() !== "")
    return { value: contact.trim(), source: "contact" };
  return { value: "", source: "missing" };
}

/**
 * The phone and e-mail the withdrawal notice names, as the backend picks
 * them (`withdrawalAddressee` in the care contract): the Träger's own for
 * withdrawals, else the contact person's, field by field.
 */
export function withdrawalReach(
  contact: TraegerContact,
  own: TraegerWithdrawalContact,
): WithdrawalReach {
  return {
    phone: pick(own.phone, contact.phone),
    email: pick(own.email, contact.email),
  };
}

/** The letterhead's lines without blank ones, as the backend reads them. */
function letterheadLines(letterheadText: string): string[] {
  return letterheadText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * How complete the letterhead is for the notice (#8131): name and address,
 * only a name, or nothing.
 */
export type WithdrawalSenderSource = "letterhead" | "incomplete" | "missing";

export interface WithdrawalSender {
  readonly name: string;
  readonly address: readonly string[];
  readonly source: WithdrawalSenderSource;
}

/**
 * The Träger the notice names as addressee: the letterhead's first line as
 * the name, the other lines as the address. The contact person never is
 * the addressee; it only lends phone and e-mail (#8131).
 */
export function withdrawalSender(letterheadText: string): WithdrawalSender {
  const [name = "", ...address] = letterheadLines(letterheadText);
  let source: WithdrawalSenderSource = "letterhead";
  if (name === "") source = "missing";
  else if (address.length === 0) source = "incomplete";
  return { name, address, source };
}

/**
 * The addressee in the brackets of the notice, one part per entry: the
 * letterhead's lines (name first, then the address), phone and e-mail.
 */
export function withdrawalAddressee(
  letterheadText: string,
  reach: WithdrawalReach,
): string[] {
  const lines = letterheadLines(letterheadText);
  const parts = lines.length > 0 ? lines : ["dem Träger"];
  if (reach.phone.value !== "") parts.push(`Telefon: ${reach.phone.value}`);
  if (reach.email.value !== "") parts.push(`E-Mail: ${reach.email.value}`);
  return parts;
}
