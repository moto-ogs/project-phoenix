import { describe, expect, it } from "vitest";
import { serviceDays } from "~/components/traeger/care-contract-format";
import type { ContractVersion } from "~/lib/traeger-care-contracts-api";
import {
  changedWeekdays,
  plannedVersion,
  plannedVersionText,
  signatureText,
  versionPhase,
} from "./care-contract-versions";

function version(overrides: Partial<ContractVersion>): ContractVersion {
  return {
    number: 1,
    status: "wirksam",
    source: "abschluss",
    effectiveFrom: "2026-08-01",
    endsOn: null,
    validUntil: null,
    services: [],
    createdAt: "2026-07-20T08:00:00Z",
    ...overrides,
  };
}

describe("versionPhase", () => {
  it("cuts every version by the end of the contract (#4682)", () => {
    const today = "2026-09-09";
    const withdrawn = { withdrawn: true, endsOn: null };
    expect(versionPhase(version({}), today, withdrawn)).toBe("withdrawn");
    const terminated = { withdrawn: false, endsOn: "2026-08-31" };
    expect(versionPhase(version({}), today, terminated)).toBe("ended");
    // The backend cuts the last version at the end of the contract.
    expect(
      versionPhase(version({ validUntil: "2026-08-31" }), today, terminated),
    ).toBe("ended");
    // A version a change replaced before the end stays replaced.
    expect(
      versionPhase(version({ validUntil: "2026-08-15" }), today, terminated),
    ).toBe("past");
    expect(
      versionPhase(version({ effectiveFrom: "2026-10-01" }), today, {
        withdrawn: false,
        endsOn: "2026-09-30",
      }),
    ).toBe("ended");
    expect(
      versionPhase(version({}), today, {
        withdrawn: false,
        endsOn: "2026-12-31",
      }),
    ).toBe("current");
  });

  it("never places a replaced version on a day", () => {
    expect(
      versionPhase(
        version({ status: "ersetzt", effectiveFrom: "2026-09-01" }),
        "2026-09-09",
      ),
    ).toBe("replaced");
    expect(
      plannedVersion(
        [
          version({
            status: "ersetzt",
            source: "buchungsaenderung",
            effectiveFrom: "2027-03-01",
          }),
        ],
        "2026-09-09",
      ),
    ).toBeUndefined();
  });

  it("places each version on the day by its dates, not by its status", () => {
    const today = "2026-09-09";
    expect(
      versionPhase(
        version({ status: "abgeloest", validUntil: "2027-02-28" }),
        today,
      ),
    ).toBe("current");
    expect(
      versionPhase(
        version({ status: "abgeloest", validUntil: "2026-08-31" }),
        today,
      ),
    ).toBe("past");
    expect(versionPhase(version({ effectiveFrom: "2027-03-01" }), today)).toBe(
      "planned",
    );
    expect(versionPhase(version({ status: "beantragt" }), today)).toBe(
      "pending",
    );
    expect(versionPhase(version({ status: "abgelehnt" }), today)).toBe(
      "rejected",
    );
  });

  it("names the earliest planned change, never a contract that starts later", () => {
    const later = [version({ number: 1, effectiveFrom: "2026-10-01" })];
    expect(plannedVersion(later, "2026-09-09")).toBeUndefined();
    const two = [
      version({ number: 1, status: "abgeloest", validUntil: "2027-02-28" }),
      version({
        number: 2,
        status: "abgeloest",
        source: "buchungsaenderung",
        effectiveFrom: "2027-03-01",
        validUntil: "2027-06-30",
      }),
      version({
        number: 3,
        source: "buchungsaenderung",
        effectiveFrom: "2027-07-01",
      }),
    ];
    expect(plannedVersion(two, "2026-09-09")?.number).toBe(2);
  });

  it("names the next planned version", () => {
    const versions = [
      version({ number: 1, status: "abgeloest", validUntil: "2027-02-28" }),
      version({
        number: 2,
        source: "buchungsaenderung",
        effectiveFrom: "2027-03-01",
      }),
    ];
    expect(plannedVersion(versions, "2026-09-09")?.number).toBe(2);
    expect(plannedVersion(versions, "2027-03-01")).toBeUndefined();
  });

  it("names a new assignment of the modules as a coming change (#7764)", () => {
    const versions = [
      version({ number: 1, source: "import", validUntil: "2026-09-30" }),
      version({
        number: 2,
        source: "angebotskorrektur",
        effectiveFrom: "2026-10-01",
      }),
    ];
    const planned = plannedVersion(versions, "2026-09-09");
    expect(planned?.number).toBe(2);
    expect(plannedVersionText(planned!)).toBe(
      "Ab 01.10.2026 gilt Version 2. Die Buchungen gehören dann zu anderen Modulen. Was sich ändert, steht unter „Versionen“.",
    );
    expect(plannedVersion(versions, "2026-10-01")).toBeUndefined();
  });
});

describe("changedWeekdays", () => {
  it("marks a day with another module, another end or care added", () => {
    const monday = {
      weekday: "mon" as const,
      careOfferingId: "5",
      moduleName: "Ganztag",
      endsAt: "14:00",
      lastDay: null,
    };
    const before = version({ services: [monday] });
    const after = version({
      number: 2,
      services: [
        { ...monday, endsAt: "16:30" },
        { ...monday, weekday: "fri" },
      ],
    });
    expect([...changedWeekdays(after, before)]).toEqual(["mon", "fri"]);
    expect(changedWeekdays(before, undefined).size).toBe(0);
    expect(changedWeekdays(before, before).size).toBe(0);
  });
});

describe("weekend care", () => {
  it("counts care dropped on a Saturday as a changed day and still shows the day", () => {
    const monday = {
      weekday: "mon" as const,
      careOfferingId: "5",
      moduleName: "Ganztag",
      endsAt: "14:00",
      lastDay: null,
    };
    const before = version({
      services: [monday, { ...monday, weekday: "sat" }],
    });
    const after = version({ number: 2, services: [monday] });
    const changed = changedWeekdays(after, before);
    expect([...changed]).toEqual(["sat"]);
    expect(
      serviceDays(after.services, [...changed]).map((day) => day.weekday),
    ).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
  });
});

// #4816: a changed version waits for the parents' signature, and one nobody
// signed stays in the history.
describe("versions that wait for a signature", () => {
  it("names a changed version that waits, and the first version of a draft", () => {
    expect(
      versionPhase(version({ number: 2, status: "beantragt" }), "2026-09-09"),
    ).toBe("awaiting");
    expect(
      versionPhase(version({ number: 1, status: "beantragt" }), "2026-09-09"),
    ).toBe("pending");
  });

  it("names a version nobody signed", () => {
    expect(
      versionPhase(version({ number: 2, status: "ueberholt" }), "2026-09-09"),
    ).toBe("overtaken");
  });

  it("plans no change from a version that only waits", () => {
    expect(
      plannedVersion(
        [
          version({}),
          version({
            number: 2,
            status: "beantragt",
            source: "buchungsaenderung",
            effectiveFrom: "2027-01-01",
          }),
        ],
        "2026-09-09",
      ),
    ).toBeUndefined();
  });

  it("says how the parents agreed", () => {
    expect(
      signatureText({
        versionNumber: 2,
        method: "request",
        signerName: "Eva Muster",
        signedAt: "2026-09-01T10:00:00Z",
      }),
    ).toBe(
      "Von den Eltern selbst beantragt am 01.09.2026. Der Antrag gilt als Unterschrift.",
    );
    expect(
      signatureText({
        versionNumber: 1,
        method: "drawn",
        signerName: "Eva Muster",
        signedAt: "2026-09-01T10:00:00Z",
      }),
    ).toBe("Online unterschrieben am 01.09.2026 von Eva Muster.");
  });
});
