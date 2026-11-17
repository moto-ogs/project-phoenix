// The generated decoder of the guardians' portal against a body as Go writes
// it: identifiers are strings there already (common.ID).
import { describe, expect, it } from "vitest";
import { routes } from "./parent-me.generated";

const enrollable = routes["GET /parent/me/enrollable-schools"];
const phase = `{"school_id":"9223372036854775807","school_name":"Schule am Berg","school_slug":"berg","school_subdomain":"berg","phase_id":"12","phase_name":"Schuljahr 2026/27","phase_name_translations":{"en":"School year 2026/27"},"phase_kind":"school_year","service_start_date":"2026-08-01","service_end_date":"2027-07-31","enrollment_open_at":"2026-03-01T08:00:00Z","already_linked":true,"audience":"existing_students"}`;
const body = (rows: string): unknown =>
  JSON.parse(`{"status":"success","data":[${rows}],"message":"ok"}`);

describe("parent contract decoders", () => {
  it("is registered for the guardians' portal only", () => {
    expect(enrollable.portals).toEqual(["parent"]);
  });

  it("reads a phase and keeps the largest identifier exact", () => {
    const [row] = enrollable.response.parse(body(phase)).data;
    expect(row).toMatchObject({
      school_id: "9223372036854775807",
      phase_id: "12",
      phase_kind: "school_year",
      audience: "existing_students",
      service_start_date: "2026-08-01",
    });
    expect(row?.enrollment_close_at).toBeUndefined();
  });

  it("takes an audience this build does not know yet", () => {
    const later = phase.replace("existing_students", "siblings_first");
    expect(enrollable.response.parse(body(later)).data[0]?.audience).toBe(
      "siblings_first",
    );
  });

  it.each([
    ["a numeric identifier", phase.replace('"phase_id":"12"', '"phase_id":12')],
    ["a day that is no day", phase.replace("2027-07-31", "2027-02-30")],
    ["a missing subdomain", phase.replace('"school_subdomain":"berg",', "")],
  ])("refuses %s", (_name, row) => {
    expect(enrollable.response.safeParse(body(row)).success).toBe(false);
  });

  it("refuses null in place of the list", () => {
    expect(
      enrollable.response.safeParse({ status: "success", data: null }).success,
    ).toBe(false);
  });
});
