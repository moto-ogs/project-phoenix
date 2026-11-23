import { describe, expect, it } from "vitest";
import type {
  EnrollmentBooking,
  EnrollmentReason,
  EnrollmentRow,
} from "~/lib/traeger-contract-enrollments-api";
import {
  STUCK_HAS_ENROLLMENT,
  STUCK_OTHER_PHASE,
  STUCK_WAY_OUT,
  defaultEnrollmentFilter,
  enrollmentBookingDays,
  enrollmentBookingPeriod,
  enrollmentReasonText,
  enrollmentRowTexts,
  enrollmentRunSummary,
  enrollmentStatus,
  matchesEnrollmentFilter,
} from "./care-contract-enrollment-format";

function row(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    contractId: "82",
    status: "ready",
    reason: undefined,
    action: "enroll",
    contractChild: { firstName: "Jonas", lastName: "Zimmermann" },
    student: null,
    phaseName: "",
    bookings: [],
    changes: [],
    requestChildId: null,
    followsContractId: null,
    ...overrides,
  };
}

function booking(
  overrides: Partial<EnrollmentBooking> = {},
): EnrollmentBooking {
  return {
    careOfferingId: "7",
    moduleName: "Betreuung bis 15 Uhr",
    days: ["mon", "tue", "wed", "thu", "fri"],
    validFrom: "2026-09-01",
    validUntil: "2027-08-01",
    endTimes: {
      mon: "15:00",
      tue: "15:00",
      wed: "15:00",
      thu: "15:00",
      fri: "15:00",
    },
    ...overrides,
  };
}

// Every reason the plan, the school's enrollment and the workflow name
// (ADR 0309), each with what is wrong and what to do.
const REASONS: readonly EnrollmentReason[] = [
  "contract_not_active",
  "not_begun",
  "offering_gone",
  "two_phases",
  "phase_not_begun",
  "phase_ended",
  "fixed_days",
  "day_unavailable",
  "end_time",
  "bookings_differ",
  "care_ends",
  "has_application",
  "follows_contract",
  "offering_inactive",
  "planned_change",
  "student_missing",
  "student_inactive",
  "without_care_place",
  "birth_date_missing",
  "phase_missing",
  "offering_phase",
  "booking_window",
  "care_offerings_off",
  "roster_bound",
  "care_ends_earlier",
  "window_too_short",
  "enrolled_elsewhere",
  "changed",
];

const UNKNOWN =
  "moto kann für diesen Vertrag gerade keine Anmeldung nachtragen. Lade die Vorschau neu.";

describe("Anmeldungen nachtragen: Texte", () => {
  it("gives every reason its own plain sentence of two parts", () => {
    const texts = REASONS.map((reason) =>
      enrollmentReasonText(row({ status: "held", reason })),
    );
    expect(new Set(texts).size).toBe(REASONS.length);
    for (const text of texts) {
      expect(text).not.toBe(UNKNOWN);
      // What is wrong, then what to do: two sentences, no technical words.
      expect(text.split(". ").length).toBeGreaterThanOrEqual(2);
      expect(text).not.toMatch(/Request|Fingerprint|Workflow|ID\b|—/);
    }
    expect(enrollmentReasonText(row({ status: "held" }))).toBe(UNKNOWN);
  });

  it("names the day of a planned change and the earlier contract", () => {
    expect(
      enrollmentReasonText(
        row({
          status: "held",
          reason: "planned_change",
          changes: [{ effectiveFrom: "2027-01-01", bookings: [] }],
        }),
      ),
    ).toBe(
      "Der Vertrag ändert sich ab 01.01.2027. Ab dann nimmt ein neuer Lauf ihn mit.",
    );
    expect(
      enrollmentReasonText(
        row({
          status: "held",
          reason: "follows_contract",
          followsContractId: "61",
        }),
      ),
    ).toMatch(/Vertrag Nr\. 61 mit Anmeldung/);
  });

  it("labels each status and says what the run did", () => {
    expect(enrollmentStatus(row())).toEqual({ label: "Bereit", tone: "green" });
    expect(
      enrollmentStatus(row({ status: "done", action: undefined })).label,
    ).toBe("Erledigt");
    expect(
      enrollmentStatus(row({ status: "done", action: "enroll" })).label,
    ).toBe("Nachgetragen");
    expect(
      enrollmentStatus(row({ status: "done", action: "bind" })).label,
    ).toBe("Gebunden");
    expect(enrollmentStatus(row({ status: "unlinked" })).label).toBe(
      "Ohne Kinderakte",
    );
    expect(enrollmentStatus(row({ status: "held" })).label).toBe(
      "Zurückgestellt",
    );
    expect(enrollmentStatus(row({ status: "stuck" }))).toEqual({
      label: "Hängt",
      tone: "red",
    });
    expect(enrollmentStatus(row({ status: "changed" })).label).toBe("Geändert");
    expect(enrollmentStatus(row({ status: undefined })).label).toBe("–");
  });

  it("explains a stuck row with both ways out and what does not help", () => {
    expect(
      enrollmentRowTexts(
        row({
          status: "stuck",
          reason: "bookings_differ",
          requestChildId: "140",
        }),
      ),
    ).toEqual([STUCK_WAY_OUT]);
    // Moved to another phase arrives as `has_application` too: both ways out.
    expect(
      enrollmentRowTexts(
        row({
          status: "stuck",
          reason: "has_application",
          requestChildId: "140",
        }),
      ),
    ).toEqual([STUCK_WAY_OUT, STUCK_OTHER_PHASE]);
    expect(
      enrollmentRowTexts(
        row({
          status: "stuck",
          reason: "student_inactive",
          requestChildId: "140",
        }),
      ),
    ).toEqual([
      STUCK_HAS_ENROLLMENT,
      "Die Kinderakte ist nicht mehr aktiv. Beende den Vertrag, oder die Schule nimmt das Kind wieder auf.",
    ]);
    // A planned change the enrollment does not know: its own way out.
    expect(
      enrollmentRowTexts(
        row({
          status: "stuck",
          reason: "planned_change",
          requestChildId: "140",
        }),
      ),
    ).toEqual([
      expect.stringMatching(/Die Schule bucht die Änderung nach, oder du/),
    ]);
    expect(
      enrollmentRowTexts(
        row({ status: "stuck", reason: "phase_ended", requestChildId: "140" }),
      )[0],
    ).toMatch(/Ein zweiter Vertrag entsteht dafür nicht/);
    expect(STUCK_WAY_OUT).toMatch(/oder die Schule berichtigt die Buchungen/);
    expect(STUCK_WAY_OUT).toMatch(/zu beenden hilft nicht/);
  });

  it("tells a changed row whether the enrollment exists already", () => {
    expect(
      enrollmentRowTexts(row({ status: "changed", requestChildId: "140" }))[0],
    ).toMatch(/An der Schule kann schon eine Anmeldung stehen/);
    expect(enrollmentRowTexts(row({ status: "changed" }))[0]).toMatch(
      /moto hat nichts eingetragen/,
    );
    expect(enrollmentRowTexts(row({ status: "unlinked" }))[0]).toMatch(
      /Verknüpfe ihn zuerst/,
    );
  });
});

describe("Anmeldungen nachtragen: Buchungen", () => {
  it("reads the half-open period as its last day", () => {
    expect(enrollmentBookingPeriod(booking())).toBe(
      "01.09.2026 bis 31.07.2027",
    );
    expect(enrollmentBookingPeriod(booking({ validUntil: null }))).toBe(
      "ab 01.09.2026",
    );
    expect(enrollmentBookingPeriod(booking({ validFrom: null }))).toBe("");
  });

  it("groups weekdays by their end time", () => {
    expect(enrollmentBookingDays(booking())).toBe("Mo–Fr bis 15:00");
    expect(
      enrollmentBookingDays(
        booking({
          endTimes: {
            mon: "15:00",
            tue: "15:00",
            wed: "15:00",
            thu: "15:00",
            fri: "13:00",
          },
        }),
      ),
    ).toBe("Mo–Do bis 15:00, Fr bis 13:00");
    expect(enrollmentBookingDays(booking({ days: [] }))).toBe("–");
  });
});

describe("Anmeldungen nachtragen: Filter und Ergebnis", () => {
  const counts = {
    ready: 2,
    done: 1,
    unlinked: 1,
    held: 1,
    stuck: 0,
    changed: 1,
  };

  it("opens before the run on what happens, after it on what stays open", () => {
    expect(defaultEnrollmentFilter(counts, false)).toBe("ready");
    expect(defaultEnrollmentFilter(counts, true)).toBe("open");
    expect(defaultEnrollmentFilter({ ...counts, stuck: 1 }, true)).toBe(
      "stuck",
    );
    expect(
      defaultEnrollmentFilter(
        { ...counts, ready: 0, held: 0, changed: 0 },
        false,
      ),
    ).toBe("all");
  });

  it("puts held and changed rows under „Offen“", () => {
    expect(matchesEnrollmentFilter(row({ status: "held" }), "open")).toBe(true);
    expect(matchesEnrollmentFilter(row({ status: "changed" }), "open")).toBe(
      true,
    );
    expect(matchesEnrollmentFilter(row({ status: "stuck" }), "open")).toBe(
      false,
    );
    expect(matchesEnrollmentFilter(row({ status: "stuck" }), "stuck")).toBe(
      true,
    );
    expect(matchesEnrollmentFilter(row(), "all")).toBe(true);
  });

  it("counts what a run did", () => {
    expect(
      enrollmentRunSummary([
        row({ status: "done", action: "enroll" }),
        row({ status: "done", action: "bind" }),
        row({ status: "done", action: undefined }),
        row({ status: "held" }),
        row({ status: "unlinked" }),
      ]),
    ).toEqual({ enrolled: 1, bound: 1, alreadyDone: 1, open: 2 });
  });
});
