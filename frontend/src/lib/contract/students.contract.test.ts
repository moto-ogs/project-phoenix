// The generated student decoders against response bodies as Go writes them.
// The bodies are JSON text, so numbers pass through JSON.parse as they do in
// the BFF.
import { describe, expect, it } from "vitest";
import { routes, StudentResponseSchema } from "./students.generated";

const list = routes["GET /api/students/"].response;
const detail = routes["GET /api/students/{id}"].response;

const page = `"pagination":{"current_page":1,"page_size":50,"total_pages":1,"total_records":1},"message":"ok"`;
const fullRow = `{"id":7,"person_id":8,"first_name":"Ada","last_name":"Beispiel","birthday":"2018-03-04","school_class":"2a","current_location":"Raum 1","location_since":"2026-09-09T12:00:00+02:00","group_id":3,"pickup_time":"15:30","companion_student_ids":[9,10],"departure_days":{"mon":"pickup"},"bus":false,"sick":true,"sick_since":"2026-09-09T10:00:00Z","excused":false,"class_trip":false,"photo_consent_given":false,"photo_consent_given_by":11,"has_full_access":true,"created_at":"2026-09-09T10:00:00.123456789Z","updated_at":"2026-09-09T10:00:00Z"}`;
const slimRow = `{"id":7,"first_name":"Ada","last_name":"Beispiel","school_class":"2a","current_location":"Raum 1","sick":false,"excused":false,"class_trip":false,"departure_modes":["pickup","by_boat"],"has_full_access":true}`;
const detailBody = `{"status":"success","data":${fullRow.slice(0, -1)},"has_write_access":true,"has_absence_write_access":true,"has_sick_excused_write_access":false,"consents":[{"key":"photo","state":"granted"}],"group_supervisors":[{"id":5,"first_name":"Cem","last_name":"Lehrer","role":"staff"}],"attendance_log_enabled":false,"feedback_enabled":true,"actual_arrival_by":{"kind":"staff","name":"Cem Lehrer"}},"message":"ok"}`;

const body = (text: string): unknown => JSON.parse(text);
const edited = (text: string, change: (root: any) => void): unknown => {
  const root = body(text);
  change(root);
  return root;
};
const listBody = (rows: string) =>
  `{"status":"success","data":[${rows}],${page}}`;

describe("student contract decoders", () => {
  it("reads each projection of the list with its own decoder", () => {
    const full = list.full.parse(body(listBody(fullRow)));
    expect(full.data[0]).toMatchObject({
      id: "7",
      person_id: "8",
      group_id: "3",
      companion_student_ids: ["9", "10"],
      photo_consent_given_by: "11",
      location_since: "2026-09-09T12:00:00+02:00",
    });
    expect(full.pagination.total_records).toBe(1);

    const slim = list.slim.parse(body(listBody(slimRow)));
    expect(slim.data[0]?.school_class).toBe("2a");
    // An enum value this build does not know yet still decodes.
    expect(slim.data[0]?.departure_modes).toEqual(["pickup", "by_boat"]);

    const names = list.names.parse(
      body(listBody(`{"id":"7","first_name":"Ada","last_name":"Beispiel"}`)),
    );
    expect(names.data).toEqual([
      { id: "7", first_name: "Ada", last_name: "Beispiel" },
    ]);
  });

  it("reads the detail with the fields of the embedded row", () => {
    const parsed = detail.parse(body(detailBody));
    expect(parsed.data).toMatchObject({
      id: "7",
      has_full_access: true,
      has_write_access: true,
      group_supervisors: [{ id: "5", role: "staff" }],
      actual_arrival_by: { kind: "staff" },
    });
    expect(parsed.data.privacy_consent).toBeUndefined();
  });

  it("ignores fields it does not know", () => {
    const parsed = detail.safeParse(
      edited(detailBody, (root) => {
        root.data.added_next_release = { nested: true };
        root.extra = 1;
      }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data?.data).not.toHaveProperty("added_next_release");
  });

  it.each([
    ["a missing required field", (root: any) => delete root.data.first_name],
    ["a malformed instant", (root: any) => (root.data.created_at = "gestern")],
    ["a malformed boolean", (root: any) => (root.data.sick = "yes")],
    ["a malformed identifier", (root: any) => (root.data.id = "7a")],
    ["a fractional identifier", (root: any) => (root.data.id = 7.5)],
    // A pointer with omitempty is absent when unset, never null.
    [
      "null where Go leaves the key out",
      (root: any) => (root.data.pickup_time = null),
    ],
    ["a missing envelope status", (root: any) => delete root.status],
  ])("fails on %s", (_name, change) => {
    expect(detail.safeParse(edited(detailBody, change)).success).toBe(false);
  });

  it("does not read a broken list as an empty one", () => {
    expect(
      list.full.safeParse(body(`{"status":"success","data":null,${page}}`))
        .success,
    ).toBe(false);
    expect(
      list.full.safeParse(body(`{"status":"success",${page}}`)).success,
    ).toBe(false);
    expect(list.full.safeParse({}).success).toBe(false);
    expect(list.full.parse(body(listBody(""))).data).toEqual([]);
  });

  it.each([
    ["a clock time with seconds", { pickup_time: "15:30:00" }],
    ["a clock time outside the day", { arrival_time: "24:00" }],
    ["a day that does not exist", { birthday: "2015-02-30" }],
    ["an instant in place of a day", { care_ends_on: "2026-07-31T00:00:00Z" }],
  ])("rejects %s", (_name, change) => {
    const row = { ...(body(fullRow) as object), ...change };
    expect(StudentResponseSchema.safeParse(row).success).toBe(false);
  });

  it("reads a clock time and a day in their wire form", () => {
    const row = {
      ...(body(fullRow) as object),
      pickup_time: "15:30",
      birthday: "2015-06-15",
    };
    expect(StudentResponseSchema.parse(row)).toMatchObject({
      pickup_time: "15:30",
      birthday: "2015-06-15",
    });
  });

  it("keeps the maximum int64 when it arrives as a string", () => {
    const row = fullRow.replace(`"id":7`, `"id":"9223372036854775807"`);
    expect(StudentResponseSchema.parse(body(row)).id).toBe(
      "9223372036854775807",
    );
  });

  it("rejects an identifier that JSON.parse has already rounded", () => {
    // 9223372036854775807 as a JSON number becomes 9223372036854775808.
    const row = fullRow.replace(`"id":7`, `"id":9223372036854775807`);
    expect(StudentResponseSchema.safeParse(body(row)).success).toBe(false);
  });
});
