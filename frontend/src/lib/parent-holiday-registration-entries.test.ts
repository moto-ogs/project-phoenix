import { describe, expect, it } from "vitest";
import { PARENT_HOLIDAY_REGISTRATION_ENTRIES } from "~/test/fixtures/holiday-registrations";
import { holidayConsentState } from "./holiday-consents";
import { holidayRegistrationEntriesFromBackend } from "./parent-holiday-registration-entries";

describe("holidayRegistrationEntriesFromBackend (#6673)", () => {
  it("maps the wire shape to strings and camelCase in the backend's order", () => {
    const [first, second] = holidayRegistrationEntriesFromBackend(
      PARENT_HOLIDAY_REGISTRATION_ENTRIES,
    );
    expect(first).toEqual({
      id: "12",
      traegerName: "Träger Bissendorf",
      periodName: "Weihnachtsferien 2026/27",
      firstDay: "2027-01-04",
      lastDay: "2027-01-08",
      submittedAt: "2026-09-08T09:30:00Z",
      status: "received",
      children: [
        {
          firstName: "Mia",
          weeks: [
            {
              firstDay: "2027-01-04",
              lastDay: "2027-01-08",
              timeModelName: "bis 16 Uhr",
              placement: "waitlisted",
            },
          ],
        },
      ],
      consents: [],
    });
    expect(second?.children.map((child) => child.firstName)).toEqual([
      "Mia",
      "Ben",
    ]);
  });

  it("reads an unknown state as received, an unknown placement as none, and tolerates missing lists", () => {
    const [entry] = holidayRegistrationEntriesFromBackend({
      registrations: [
        {
          id: "1",
          traeger_name: "T",
          period_name: "P",
          first_day: null,
          last_day: null,
          submitted_at: "2026-09-01T08:00:00Z",
          status: "something_new",
          consents: [],
          children: [
            {
              first_name: "Ida",
              weeks: [
                {
                  first_day: "2027-01-04",
                  last_day: "2027-01-08",
                  time_model_name: "",
                  placement: "unknown",
                  lunch: false,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(entry?.status).toBe("received");
    expect(entry?.firstDay).toBe("");
    // An unknown placement promises no place (ADR 0270 point 6, #2353).
    expect(entry?.children[0]?.weeks[0]?.placement).toBeUndefined();
    expect(
      holidayRegistrationEntriesFromBackend({ registrations: null }),
    ).toEqual([]);
  });

  it("maps the voluntary consents and tells given, withdrawn and never given apart (#8038)", () => {
    const [entry] = holidayRegistrationEntriesFromBackend({
      registrations: [
        {
          ...PARENT_HOLIDAY_REGISTRATION_ENTRIES.registrations![0]!,
          consents: [
            {
              key: "a",
              title: "A",
              label: "a",
              text: "",
              given: true,
              changed_at: "2026-09-01T08:00:00Z",
            },
            {
              key: "b",
              title: "B",
              label: "b",
              text: "Text",
              given: false,
              changed_at: "2026-09-02T08:00:00Z",
            },
            {
              key: "c",
              title: "C",
              label: "c",
              text: "",
              given: false,
              changed_at: null,
            },
          ],
        },
      ],
    });
    expect(entry?.consents[1]).toEqual({
      key: "b",
      title: "B",
      label: "b",
      text: "Text",
      given: false,
      changedAt: "2026-09-02T08:00:00Z",
    });
    expect(entry?.consents.map(holidayConsentState)).toEqual([
      "given",
      "withdrawn",
      "notGiven",
    ]);
  });
});
