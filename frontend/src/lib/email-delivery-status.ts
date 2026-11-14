/**
 * What became of a mail, as Delivery names it (#5934). "accepted" only means a
 * mail server took it; "delivered" needs a report of the mail provider. The two
 * must never read alike.
 */
export type MailOutcome =
  | "queued"
  | "accepted"
  | "delivered"
  | "delayed"
  | "undeliverable"
  | "blocked"
  | "provider_blocked"
  | "held_by_stop"
  | "held_by_departure"
  | "unsubscribed"
  | "overdue"
  | "complained"
  | "send_failed"
  | "unknown"
  | "cancelled";

/** Why the school's list holds an address. It stays until someone checked it. */
export type EmailAddressMark = "failed" | "complained";

/**
 * The mail provider's block of an address right now, read exactly for it. Unset
 * means nobody asked: an old mail alone says nothing about it.
 */
export type MailProviderBlock = "none" | "active" | "unreadable";

export interface MailStatusCopy {
  readonly label: string;
  readonly tone: "blue" | "green" | "warning" | "red" | "gray";
  /** One line that says what happened and who acts next. */
  readonly explanation?: string;
}

const ADDRESS_COPY: Record<EmailAddressMark, MailStatusCopy> = {
  failed: {
    label: "Adresse prüfen",
    tone: "red",
    explanation:
      "Mails an diese Adresse kommen nicht an. Sie ist deshalb gesperrt, und moto sendet nichts mehr dorthin.",
  },
  complained: {
    label: "Adresse prüfen",
    tone: "red",
    explanation:
      "Diese Person hat eine Mail als unerwünscht gemeldet. Die Adresse ist deshalb gesperrt. Sprechen Sie die Person direkt an.",
  },
};

/**
 * The school's decision about a person, not a problem of an address. It follows
 * the person to a new address, so it never reads like "Adresse prüfen".
 */
export const GUARDIAN_STOPPED_COPY: MailStatusCopy = {
  label: "Versand gestoppt",
  tone: "gray",
  explanation:
    "Ihre Schule hat die Mails an diese Person gestoppt. Anmeldecodes, Mails zum Passwort und Abrechnungsbriefe des Trägers kommen weiter an.",
};

/** The current departure hold, separate from the outcome of an earlier mail. */
export const GUARDIAN_DEPARTED_COPY: MailStatusCopy = {
  label: "Kein Kind in Betreuung",
  tone: "gray",
  explanation:
    "Kein Kind dieser Person wird noch an Ihrer Schule betreut. Elternbriefe, Nachrichten, Termine und Einladungen gehen deshalb nicht mehr an sie.",
};

/** Mails still go out to an address someone else holds without a stop. */
export const STOP_SHARED_NOTE =
  "Diese Adresse nutzt noch eine andere Person. Mails an die Adresse gehen deshalb weiter raus.";

const PROVIDER_ACTIVE_COPY: MailStatusCopy = {
  label: "Gesperrt",
  tone: "red",
  explanation:
    "Diese Adresse ist gesperrt. Eine neue Mail hilft nicht. Der moto-Support muss das klären.",
};

const PROVIDER_UNREADABLE_COPY: MailStatusCopy = {
  label: "Stand unklar",
  tone: "gray",
  explanation:
    "Ob diese Adresse gesperrt ist, lässt sich gerade nicht prüfen. Bitte versuchen Sie es später noch einmal.",
};

const PROVIDER_GONE_COPY: MailStatusCopy = {
  label: "Nicht gesendet",
  tone: "gray",
  explanation:
    "Die Mail ging nicht raus. Die Sperre besteht nicht mehr. Sie können neu senden.",
};

const OUTCOME_COPY: Record<MailOutcome, MailStatusCopy> = {
  queued: { label: "Wird gesendet", tone: "blue" },
  accepted: {
    label: "Versendet",
    tone: "gray",
    explanation:
      "Die Mail ist raus. Ob sie im Postfach angekommen ist, ist nicht bekannt.",
  },
  delivered: { label: "Zugestellt", tone: "green" },
  delayed: {
    label: "Verzögert",
    tone: "warning",
    explanation:
      "Die Mail kommt später an, es wird weiter versucht. Bitte senden Sie sie nicht noch einmal, sonst kommt sie doppelt an.",
  },
  undeliverable: {
    label: "Nicht zustellbar",
    tone: "red",
    explanation: "Die Mail kam nicht an.",
  },
  blocked: {
    label: "Nicht gesendet",
    tone: "gray",
    explanation:
      "Die Mail ging nicht raus, weil die Adresse gesperrt war. Sie können sie neu senden.",
  },
  provider_blocked: {
    label: "Nicht gesendet",
    tone: "gray",
    explanation:
      "Diese Adresse war beim Versand gesperrt. Besteht die Sperre noch, klärt das der moto-Support.",
  },
  held_by_stop: {
    label: "Nicht gesendet",
    tone: "gray",
    explanation:
      "Die Mail ging nicht raus, weil die Mails an diese Person gestoppt waren. Sie können sie neu senden.",
  },
  held_by_departure: {
    label: "Nicht gesendet",
    tone: "gray",
    explanation:
      "Kein Kind dieser Person wurde beim Versand noch betreut. Die Mail ging deshalb nicht raus.",
  },
  unsubscribed: {
    label: "Abgemeldet",
    tone: "gray",
    explanation:
      "Diese Person hat sich von den Mails abgemeldet. Sprechen Sie sie direkt an.",
  },
  overdue: {
    label: "Überfällig",
    tone: "warning",
    explanation:
      "Die Mail ist seit Tagen verzögert. Sie können sie noch einmal senden.",
  },
  // The mail arrived; the person reported it afterwards (#6999). It never
  // reads like a mail that did not arrive.
  complained: {
    label: "Als unerwünscht gemeldet",
    tone: "red",
    explanation: "Diese Person hat die Mail als unerwünscht gemeldet.",
  },
  send_failed: {
    label: "Fehlgeschlagen",
    tone: "red",
    explanation: "Das Senden hat nicht geklappt. Bitte senden Sie neu.",
  },
  unknown: {
    label: "Ergebnis unbekannt",
    tone: "gray",
    explanation: "Ob die Mail rausging, ist nicht bekannt.",
  },
  cancelled: { label: "Abgebrochen", tone: "gray" },
};

/**
 * The words for one mail and its address. A mark outranks the mail: while the
 * address is held, the next step is to check it, whatever the last mail did. A
 * stop outranks the mail too, since no next mail goes out either. So does what the
 * provider says about the address now: the last mail's result is history.
 * Returns null when nothing is known yet, so a caller shows no status at all.
 */
export function mailStatusCopy(
  outcome?: MailOutcome | "",
  mark?: EmailAddressMark | "",
  stopped?: boolean,
  providerBlock?: MailProviderBlock,
): MailStatusCopy | null {
  if (mark) return ADDRESS_COPY[mark];
  if (stopped) return GUARDIAN_STOPPED_COPY;
  if (providerBlock === "unreadable") return PROVIDER_UNREADABLE_COPY;
  if (outcome === "provider_blocked") {
    if (providerBlock === "active") return PROVIDER_ACTIVE_COPY;
    if (providerBlock === "none") return PROVIDER_GONE_COPY;
  }
  if (!outcome) return null;
  return OUTCOME_COPY[outcome] ?? null;
}

/**
 * A refusal belongs to the address it came from. Once the person has another
 * address, the row says so and that a new mail can go there.
 */
export function correctedAddressCopy(
  outcome?: MailOutcome | "",
): MailStatusCopy | null {
  switch (outcome) {
    case "unsubscribed":
      return {
        label: "Alte Adresse abgemeldet",
        tone: "gray",
        explanation:
          "Die alte Adresse war abgemeldet. Eine neue Mail an die neue Adresse ist möglich.",
      };
    case "complained":
      return {
        label: "Alte Adresse gesperrt",
        tone: "gray",
        explanation:
          "Die Mail an die alte Adresse wurde als unerwünscht gemeldet. Eine neue Mail an die neue Adresse ist möglich.",
      };
    default:
      return null;
  }
}

/**
 * The next step on a guardian's card. Only a bounced address can be freed by the
 * school: a complaint stays.
 */
export function guardianAddressNextStep(mark: EmailAddressMark): string {
  switch (mark) {
    case "failed":
      return "Stimmt die Adresse nicht, ändern Sie sie unter „Bearbeiten“. Stimmt sie, wählen Sie „Sperre aufheben“.";
    case "complained":
      return "Sie können diese Sperre nicht aufheben. Eine andere Adresse tragen Sie unter „Bearbeiten“ ein.";
  }
}

/** Where a school corrects an address it sees outside the guardian's card. */
export const CHECK_ADDRESS_AT_GUARDIAN =
  "Korrigieren Sie die Adresse beim Kind unter „Erziehungsberechtigte“.";

/** Whoever sees a letter without the OGS's access to the guardian's card. */
export const TELL_THE_OGS_ABOUT_THE_ADDRESS =
  "Sagen Sie der OGS Bescheid. Dort lässt sich die Adresse korrigieren.";

/** What Delivery knows about the mail of an invitation (#5934, #5960). */
export interface InvitationMail {
  readonly mailOutcome?: MailOutcome;
  readonly addressMark?: EmailAddressMark;
  readonly providerBlock?: MailProviderBlock;
}

/**
 * The line under an invitation of a staff member or a caterer. Their mail still
 * goes out to a marked address (#5935), so the note only says what is known about
 * the address and never speaks of a block. The address of an invitation is fixed:
 * nextStep names the new invitation.
 */
export function invitationMailNote(
  mail: InvitationMail,
  nextStep: string,
): string | null {
  if (mail.mailOutcome === "undeliverable") {
    return `Die Mail kam nicht an. ${nextStep}`;
  }
  if (mail.addressMark === "complained") {
    return `Von dieser Adresse kam eine Beschwerde über eine Mail. ${nextStep}`;
  }
  if (mail.addressMark === "failed") {
    return `Eine frühere Mail an diese Adresse kam nicht an. ${nextStep}`;
  }
  if (mail.mailOutcome === "accepted") return null;
  return (
    mailStatusCopy(mail.mailOutcome, "", false, mail.providerBlock)
      ?.explanation ?? null
  );
}

/** The mails of one message to several families, counted by outcome (#7058). */
export type MailOutcomeCounts = Readonly<Partial<Record<MailOutcome, number>>>;

/** One group of mails with the same result, as a message's summary shows it. */
export interface MailOutcomeGroup {
  readonly count: number;
  /** „12 zugestellt“, „1 nicht zustellbar“. */
  readonly label: string;
  readonly tone: MailStatusCopy["tone"];
}

// The word after a count. Results a school treats alike share a word, so a
// summary never lists two kinds of „nicht gesendet“ side by side.
const COUNT_WORDS: Record<MailOutcome, readonly [one: string, many: string]> = {
  queued: ["wird gesendet", "werden gesendet"],
  accepted: ["versendet", "versendet"],
  delivered: ["zugestellt", "zugestellt"],
  delayed: ["verzögert", "verzögert"],
  overdue: ["überfällig", "überfällig"],
  undeliverable: ["nicht zustellbar", "nicht zustellbar"],
  blocked: ["nicht gesendet", "nicht gesendet"],
  provider_blocked: ["nicht gesendet", "nicht gesendet"],
  held_by_stop: ["nicht gesendet", "nicht gesendet"],
  held_by_departure: ["nicht gesendet", "nicht gesendet"],
  unsubscribed: ["abgemeldet", "abgemeldet"],
  complained: ["als unerwünscht gemeldet", "als unerwünscht gemeldet"],
  send_failed: ["fehlgeschlagen", "fehlgeschlagen"],
  unknown: ["Ergebnis unbekannt", "Ergebnis unbekannt"],
  cancelled: ["abgebrochen", "abgebrochen"],
};

const TONE_RANK: Record<MailStatusCopy["tone"], number> = {
  red: 0,
  warning: 1,
  gray: 2,
  blue: 3,
  green: 4,
};

/**
 * The mails of a message grouped by result, the one that needs attention
 * first: „1 nicht zustellbar · 11 zugestellt“. Unknown outcomes are left out;
 * an empty list means no mail went out.
 */
export function mailOutcomeGroups(
  counts: MailOutcomeCounts | undefined,
): MailOutcomeGroup[] {
  const groups = new Map<
    string,
    {
      count: number;
      tone: MailStatusCopy["tone"];
      words: readonly [string, string];
    }
  >();
  for (const [outcome, count] of Object.entries(counts ?? {})) {
    const words = COUNT_WORDS[outcome as MailOutcome];
    const copy = OUTCOME_COPY[outcome as MailOutcome];
    if (!words || !copy || !count) continue;
    const group = groups.get(words[1]);
    if (group) {
      group.count += count;
      if (TONE_RANK[copy.tone] < TONE_RANK[group.tone]) group.tone = copy.tone;
    } else {
      groups.set(words[1], { count, tone: copy.tone, words });
    }
  }
  return [...groups.values()]
    .map(({ count, tone, words }) => ({
      count,
      tone,
      label: `${count} ${count === 1 ? words[0] : words[1]}`,
    }))
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.count - a.count);
}

// Results of a mail that never reached the family and will not by itself:
// refused, given up on, held for a blocked address or days late. The backend
// names the guardians of these results (#7058).
const NOT_ARRIVED_OUTCOMES: readonly MailOutcome[] = [
  "undeliverable",
  "send_failed",
  "blocked",
  "provider_blocked",
  "overdue",
];

/** How many of the counted mails did not reach their family. */
export function mailsNotArrived(counts: MailOutcomeCounts | undefined): number {
  return NOT_ARRIVED_OUTCOMES.reduce(
    (sum, outcome) => sum + (counts?.[outcome] ?? 0),
    0,
  );
}

/** The counts of several mailings added up, outcome by outcome. */
export function sumMailOutcomeCounts(
  all: readonly MailOutcomeCounts[],
): MailOutcomeCounts {
  const total: Partial<Record<MailOutcome, number>> = {};
  for (const counts of all) {
    for (const [outcome, count] of Object.entries(counts)) {
      const key = outcome as MailOutcome;
      total[key] = (total[key] ?? 0) + (count ?? 0);
    }
  }
  return total;
}

/** Whether a mail's result asks the school to act: it did not arrive. */
export function mailNeedsAttention(copy: MailStatusCopy | null): boolean {
  return copy?.tone === "red" || copy?.tone === "warning";
}

/**
 * The line under a mail nobody can send again from the screen (#7058): what
 * happened and who acts next, never „senden Sie neu“. Null while the mail
 * needs nothing, so a delivered or accepted mail stays quiet.
 */
export function undeliveredMailNote(
  outcome: MailOutcome | null | undefined,
  nextStep: string,
): string | null {
  switch (outcome) {
    case "undeliverable":
    case "send_failed":
      return `Die Mail kam nicht an. ${nextStep}`;
    case "complained":
      return `Die Mail wurde als unerwünscht gemeldet. ${nextStep}`;
    case "overdue":
      return `Die Mail ist seit Tagen verzögert. ${nextStep}`;
    case "delayed":
      return "Die Mail kommt später an. moto versucht es weiter.";
    default:
      return null;
  }
}

/**
 * The same line for the mails of one occasion, counted by outcome. A complaint
 * is no mail that did not arrive (#6999): it gets its own words.
 */
export function undeliveredMailsNote(
  counts: MailOutcomeCounts | null | undefined,
  nextStep: string,
): string | null {
  const missing = mailsNotArrived(counts ?? undefined);
  if (missing > 0) {
    return `${missing === 1 ? "Eine Mail kam" : `${missing} Mails kamen`} nicht an. ${nextStep}`;
  }
  const complained = counts?.complained ?? 0;
  if (complained > 0) {
    return `${complained === 1 ? "Eine Mail wurde" : `${complained} Mails wurden`} als unerwünscht gemeldet. Sprechen Sie die Person direkt an.`;
  }
  const late = counts?.delayed ?? 0;
  if (late > 0) {
    return `${late === 1 ? "Eine Mail kommt" : `${late} Mails kommen`} später an. moto versucht es weiter.`;
  }
  return null;
}
