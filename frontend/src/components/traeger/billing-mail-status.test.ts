import { describe, expect, it } from "vitest";
import { type LetterMailState, letterSendCounts } from "./billing-mail-status";

const letter = (overrides: Partial<LetterMailState>): LetterMailState => ({
  status: "not_sent",
  recipientEmail: "eva@example.org",
  requestedAt: null,
  sentAt: null,
  ...overrides,
});

describe("letterSendCounts", () => {
  it("puts every letter in exactly one tile, as the backend counts them", () => {
    const counts = letterSendCounts([
      letter({}),
      letter({ recipientEmail: " " }),
      letter({ status: "queued" }),
      letter({ status: "sent", mailOutcome: "delayed" }),
      letter({ status: "sent" }),
      letter({ status: "sent", mailOutcome: "delivered" }),
      letter({ status: "sent", mailOutcome: "undeliverable" }),
      letter({ status: "failed" }),
      letter({ status: "unknown" }),
    ]);

    expect(counts).toEqual({
      letters: 9,
      sent: 2,
      queued: 2,
      failed: 3,
      notSent: 2,
      withoutEmail: 1,
    });
  });
});
