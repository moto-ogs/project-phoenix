import { describe, expect, it } from "vitest";

import {
  correctedAddressCopy,
  guardianAddressNextStep,
  mailOutcomeGroups,
  mailStatusCopy,
} from "./email-delivery-status";

describe("mailStatusCopy", () => {
  it("never calls anything but a reported delivery delivered", () => {
    for (const outcome of [
      "queued",
      "accepted",
      "delayed",
      "undeliverable",
      "blocked",
      "complained",
      "send_failed",
      "unknown",
      "cancelled",
    ] as const) {
      expect(mailStatusCopy(outcome)?.label).not.toBe("Zugestellt");
    }
    expect(mailStatusCopy("delivered")?.label).toBe("Zugestellt");
  });

  it("never calls a reported mail undelivered (#6999)", () => {
    expect(mailStatusCopy("complained")?.label).toBe(
      "Als unerwünscht gemeldet",
    );
    expect(mailStatusCopy("complained")?.label).not.toBe(
      mailStatusCopy("undeliverable")?.label,
    );
  });

  it("lets the mark of an address outrank the mail", () => {
    expect(mailStatusCopy("delivered", "failed")?.label).toBe("Adresse prüfen");
    expect(mailStatusCopy("accepted", "", true)?.label).toBe(
      "Versand gestoppt",
    );
  });

  it("has no status before a mail or a mark exists", () => {
    expect(mailStatusCopy()).toBeNull();
    expect(mailStatusCopy("", "")).toBeNull();
  });

  it("explains every block in words a person can act on", () => {
    for (const mark of ["failed", "complained"] as const) {
      expect(mailStatusCopy(undefined, mark)?.explanation).toBeTruthy();
      expect(guardianAddressNextStep(mark)).toBeTruthy();
    }
    expect(mailStatusCopy("delayed")?.explanation).toMatch(/nicht noch einmal/);
  });

  it("keeps a stop and a marked address apart", () => {
    expect(mailStatusCopy("accepted", "failed", true)?.label).toBe(
      "Adresse prüfen",
    );
    expect(mailStatusCopy(undefined, undefined, true)?.label).not.toBe(
      "Adresse prüfen",
    );
  });

  it("does not blame the address for a mail that failed for another reason", () => {
    expect(mailStatusCopy("undeliverable")?.explanation).not.toMatch(/Adresse/);
  });

  it("does not claim a block was lifted", () => {
    expect(mailStatusCopy("blocked")?.explanation).not.toMatch(/aufgehoben/);
  });

  it("names an unsubscribe as one, not as a failed mail", () => {
    const copy = mailStatusCopy("unsubscribed");
    expect(copy?.label).toBe("Abgemeldet");
    expect(copy?.explanation).not.toMatch(/kommt nicht an|kam nicht an/);
  });

  it("offers a new mail after a delay ran past its limit", () => {
    expect(mailStatusCopy("overdue")?.explanation).toMatch(
      /noch einmal senden/,
    );
  });

  it("decides by the provider's block as it is now, not by the old mail", () => {
    expect(
      mailStatusCopy("provider_blocked", "", false, "active")?.explanation,
    ).toMatch(/moto-Support/);
    expect(
      mailStatusCopy("provider_blocked", "", false, "unreadable")?.explanation,
    ).toMatch(/später noch einmal/);
    expect(
      mailStatusCopy("provider_blocked", "", false, "none")?.explanation,
    ).toMatch(/Du kannst neu senden/);
    expect(mailStatusCopy("provider_blocked")?.explanation).not.toMatch(
      /neu senden/,
    );
  });

  it("gives no hint at another school", () => {
    for (const block of ["active", "unreadable", "none"] as const) {
      expect(
        mailStatusCopy("provider_blocked", "", false, block)?.explanation,
      ).not.toMatch(/Schule/);
    }
  });

  it("does not blame the address for a mail the stop held back", () => {
    expect(mailStatusCopy("held_by_stop")?.explanation).toMatch(/gestoppt/);
    expect(mailStatusCopy("held_by_stop")?.explanation).not.toMatch(/Adresse/);
  });

  it("names the departed family, not the address, and offers no resend", () => {
    const copy = mailStatusCopy("held_by_departure");
    expect(copy?.label).toBe("Nicht gesendet");
    expect(copy?.explanation).toMatch(/Kein Kind/);
    expect(copy?.explanation).not.toMatch(/Adresse|neu senden/);
  });
});

describe("correctedAddressCopy", () => {
  it("only speaks for a refusal", () => {
    expect(correctedAddressCopy("unsubscribed")?.explanation).toContain(
      "neue Adresse",
    );
    expect(correctedAddressCopy("complained")?.explanation).toContain(
      "neue Adresse",
    );
    expect(correctedAddressCopy("undeliverable")).toBeNull();
    expect(correctedAddressCopy("")).toBeNull();
  });
});

describe("mailOutcomeGroups (#7058)", () => {
  it("puts the mails that need attention first and counts them in German", () => {
    expect(
      mailOutcomeGroups({ delivered: 11, undeliverable: 1, accepted: 2 }),
    ).toEqual([
      { count: 1, label: "1 nicht zustellbar", tone: "red" },
      { count: 2, label: "2 versendet", tone: "gray" },
      { count: 11, label: "11 zugestellt", tone: "green" },
    ]);
  });

  it("merges the kinds of mail that stayed back into one group", () => {
    expect(
      mailOutcomeGroups({ blocked: 1, held_by_stop: 1, held_by_departure: 1 }),
    ).toEqual([{ count: 3, label: "3 nicht gesendet", tone: "gray" }]);
  });

  it("speaks of one mail on its way and of several", () => {
    expect(mailOutcomeGroups({ queued: 1 })[0]?.label).toBe("1 wird gesendet");
    expect(mailOutcomeGroups({ queued: 4 })[0]?.label).toBe(
      "4 werden gesendet",
    );
  });

  it("shows nothing for no mail and drops outcomes it does not know", () => {
    expect(mailOutcomeGroups(undefined)).toEqual([]);
    expect(mailOutcomeGroups({})).toEqual([]);
    expect(
      mailOutcomeGroups({ ["teleported" as "queued"]: 2, delivered: 1 }),
    ).toEqual([{ count: 1, label: "1 zugestellt", tone: "green" }]);
  });
});
