// Spike #2342: the same checks against both generated variants, on response
// bodies the Go types rendered (fixtures/fixtures.json).
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import fixtures from "./fixtures/fixtures.json";
import * as own from "./own/students.generated";
import * as oas from "./openapi/generated/zod.gen";

type Fixture = keyof typeof fixtures;
const body = (name: Fixture): unknown => JSON.parse(fixtures[name]);
const edit = (name: Fixture, change: (root: any) => void): unknown => {
  const root = body(name);
  change(root);
  return root;
};

const ownList = own.routes["GET /api/students/"].response;
const ownDetail = own.routes["GET /api/students/{id}"].response;
const ownPickup =
  own.routes["GET /api/students/{id}/pickup-schedules"].response;

interface Variant {
  name: string;
  listFull: z.ZodType;
  listSlim: z.ZodType;
  listNames: z.ZodType;
  detail: z.ZodType;
  pickup: z.ZodType;
  attendance: z.ZodType;
  stringId: z.ZodType;
}

const variants: Variant[] = [
  {
    name: "own generator",
    listFull: ownList.full,
    listSlim: ownList.slim,
    listNames: ownList.names,
    detail: ownDetail,
    pickup: ownPickup,
    attendance: own.DailyAttendanceStatusSchema,
    stringId: own.StringIDProbeSchema,
  },
  {
    name: "openapi",
    // One schema for all three views: OpenAPI cannot key the response on ?view.
    listFull: oas.zGetStudentsResponse,
    listSlim: oas.zGetStudentsResponse,
    listNames: oas.zGetStudentsResponse,
    detail: oas.zGetStudentsIdResponse,
    pickup: oas.zGetStudentsIdPickupSchedulesResponse,
    attendance: oas.zDailyAttendanceStatus,
    stringId: oas.zStringIdProbe,
  },
];

describe.each(variants)("$name", (v) => {
  // Measured failures of the OpenAPI variant, kept visible instead of deleted.
  const knownOpenApiGap = v.name === "openapi" ? it.fails : it;

  it("decodes every real body", () => {
    expect(v.listFull.safeParse(body("list_full")).success).toBe(true);
    expect(v.listSlim.safeParse(body("list_slim")).success).toBe(true);
    expect(v.listNames.safeParse(body("list_names")).success).toBe(true);
    expect(v.listFull.safeParse(body("list_empty")).success).toBe(true);
    expect(v.detail.safeParse(body("detail")).success).toBe(true);
    expect(v.detail.safeParse(body("detail_minimal")).success).toBe(true);
    expect(v.pickup.safeParse(body("pickup")).success).toBe(true);
    expect(v.pickup.safeParse(body("pickup_zero")).success).toBe(true);
    expect(v.attendance.safeParse(body("probe_attendance")).success).toBe(true);
    expect(
      v.attendance.safeParse(body("probe_attendance_zero_date")).success,
    ).toBe(true);
    expect(v.stringId.safeParse(body("probe_string_id_minimal")).success).toBe(
      true,
    );
  });

  it("ignores unknown fields", () => {
    const parsed = v.detail.safeParse(
      edit("detail", (r) => {
        r.data.added_next_release = 1;
        r.extra = true;
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("fails on a missing required field", () => {
    expect(
      v.detail.safeParse(
        edit("detail", (r) => {
          delete r.data.first_name;
        }),
      ).success,
    ).toBe(false);
    expect(
      v.listNames.safeParse(
        edit("list_names", (r) => {
          delete r.data[0].last_name;
        }),
      ).success,
    ).toBe(false);
  });

  it("fails on a malformed required field", () => {
    expect(
      v.detail.safeParse(
        edit("detail", (r) => {
          r.data.created_at = "yesterday";
        }),
      ).success,
    ).toBe(false);
    expect(
      v.detail.safeParse(
        edit("detail", (r) => {
          r.data.sick = "yes";
        }),
      ).success,
    ).toBe(false);
    expect(
      v.attendance.safeParse(
        edit("probe_attendance", (r) => {
          r.date = "2026-02-30";
        }),
      ).success,
    ).toBe(false);
  });

  it("does not take a broken list for an empty one", () => {
    expect(v.listFull.safeParse(body("list_nil")).success).toBe(false);
    expect(
      v.listFull.safeParse(
        edit("list_full", (r) => {
          delete r.data;
        }),
      ).success,
    ).toBe(false);
  });

  it("keeps null and absent apart", () => {
    // pointer without omitempty: null allowed, absent not
    expect(
      v.pickup.safeParse(
        edit("pickup", (r) => {
          delete r.data.effective_schedules[0].offering_schedule;
        }),
      ).success,
    ).toBe(false);
    // pointer with omitempty: absent allowed, null not
    expect(
      v.detail.safeParse(
        edit("detail", (r) => {
          r.data.pickup_time = null;
        }),
      ).success,
    ).toBe(false);
  });

  it("the outer field of an embedded struct wins", () => {
    const parsed = v.detail.parse(body("detail")) as {
      data: { has_full_access: boolean };
    };
    expect(parsed.data.has_full_access).toBe(false);
  });

  it("accepts an instant with a Berlin offset", () => {
    expect(fixtures.list_slim).toContain("+02:00");
    expect(v.listSlim.safeParse(body("list_slim")).success).toBe(true);
  });

  // union of three shapes without a discriminator: the names schema matches a
  // slim row first and strips the rest.
  knownOpenApiGap("keeps the slim fields of a slim row", () => {
    const parsed = v.listSlim.parse(body("list_slim")) as {
      data: Record<string, unknown>[];
    };
    expect(parsed.data[0]).toHaveProperty("school_class", "2a");
  });

  // format int64 becomes z.coerce.bigint(), while types.gen.ts says number.
  knownOpenApiGap("hands out identifiers as strings", () => {
    const parsed = v.listNames.parse(body("list_names")) as {
      data: { id: unknown }[];
    };
    expect(parsed.data[0]?.id).toBe("7");
  });

  it("round-trips the maximum int64 sent as a string", () => {
    const parsed = v.stringId.parse(body("probe_string_id")) as {
      id: unknown;
      person_id: unknown;
    };
    expect(parsed.id).toBe("9223372036854775807");
    expect(parsed.person_id).toBe("9223372036854775807");
  });

  it("does not hand out a rounded identifier when the maximum int64 came as a number", () => {
    // JSON.parse has already turned 9223372036854775807 into 9223372036854775808.
    const parsed = v.listNames.safeParse(body("list_names_max_id"));
    const id = parsed.success
      ? String((parsed.data as { data: { id: unknown }[] }).data[0]?.id)
      : "rejected";
    expect(id).not.toBe("9223372036854775808");
  });
});
