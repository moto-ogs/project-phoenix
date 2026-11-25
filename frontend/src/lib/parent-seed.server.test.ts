import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_CLOCK_TODAY } from "~/test/clock";
import type { ServerSeed } from "~/lib/swr/server-seed";

const { answers, snapshot } = vi.hoisted(() => ({
  answers: new Map<string, { status: number; body: unknown }>(),
  snapshot: {
    current: null as null | {
      session: Session;
      accessToken: string;
      notBooked: boolean;
    },
  },
}));

vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: async (endpoint: string) => {
    const answer = answers.get(endpoint);
    if (!answer) throw new Error(`unrouted ${endpoint}`);
    return Response.json(answer.body, { status: answer.status });
  },
}));
vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: async () => snapshot.current,
}));

import {
  isProtectedParentPath,
  loadParentPageSeed,
  loadParentShellSeed,
} from "./parent-seed.server";
import { parentKeys } from "~/lib/swr/parent-keys";
import { sessionGeneration } from "~/lib/swr/session-generation";

const parent: Session = {
  user: { id: "41", scope: "parent" },
  expires: "2099-01-01",
};

function child(studentId: string, tenantId: string) {
  return {
    student_id: studentId,
    tenant_id: tenantId,
    first_name: `Kind ${studentId}`,
    last_name: "Muster",
    status: "active",
    school_name: `Schule ${tenantId}`,
    school_slug: `schule-${tenantId}`,
    care_ended: false,
  };
}

// Two children at two schools (two relationships).
const children = [child("7", "1"), child("8", "2")];

const features = {
  conference_book_allowed: false,
  care_ended: false,
  sick_note_enabled: true,
  excused_note_enabled: true,
  sick_requires_approval: false,
  excused_requires_approval: false,
  notes_enabled: true,
  request_submit_enabled: true,
  pickup_change_enabled: true,
  pickup_change_mode_enabled: false,
  pickup_change_cutoff_time: "12:00",
  pickup_change_today_closed: false,
  pickup_change_care_day_ended: false,
  pickup_manage_allowed: true,
  emergency_contact_manage_allowed: true,
  guardian_contact_manage_allowed: true,
  absence_request_edit_enabled: true,
  related_accounts_invite_enabled: true,
  related_accounts_remove_enabled: true,
  master_data_edit_enabled: true,
  master_data_contact_edit_enabled: true,
  master_data_request_enabled: true,
  meal_plan_enabled: false,
  meal_registration_enabled: false,
  has_open_change_request: false,
  parent_news_enabled: true,
  reason_required: false,
  care_facility_term: "OGS",
};

const ok = (data: unknown) => ({
  status: 200,
  body: { status: "success", data },
});

function routeFamily() {
  answers.set("/parent/me/children", ok(children));
  for (const { student_id: id } of children) {
    answers.set(`/parent/me/children/${id}/features`, ok(features));
    answers.set(
      `/parent/me/children/${id}/today`,
      ok({ at_ogs: true, state: "present" }),
    );
  }
}

async function valuesOf(seed: ServerSeed | null) {
  expect(seed).not.toBeNull();
  return Object.fromEntries(
    await Promise.all(
      seed!.entries.map(async (entry) => [entry.key, await entry.value]),
    ),
  );
}

beforeEach(() => {
  answers.clear();
  snapshot.current = { session: parent, accessToken: "t", notBooked: false };
  routeFamily();
});

describe("parent page seeds", () => {
  it("seeds the start page per relationship under the readers' keys", async () => {
    const seed = await loadParentPageSeed({ kind: "start" });

    expect(seed?.generation).toBe(sessionGeneration(parent));
    const values = await valuesOf(seed);
    const featureKey = parentKeys.features(children, TEST_CLOCK_TODAY);
    const todayKey = parentKeys.today(children, TEST_CLOCK_TODAY);
    expect(Object.keys(values).sort()).toEqual(
      [parentKeys.shellChildren(), featureKey, todayKey].sort(),
    );
    expect(values[featureKey]).toEqual({ "7": features, "8": features });
    expect(seed?.entries.every((entry) => entry.render)).toBe(true);
  });

  it("drops only a collection one relationship fails in", async () => {
    // Permission for one relationship only: its status read is refused.
    answers.set("/parent/me/children/8/today", {
      status: 403,
      body: { status: "error", code: "care.guardian_permission_denied" },
    });

    const values = await valuesOf(await loadParentPageSeed({ kind: "start" }));

    expect(
      values[parentKeys.today(children, TEST_CLOCK_TODAY)],
    ).toBeUndefined();
    expect(values[parentKeys.features(children, TEST_CLOCK_TODAY)]).toEqual({
      "7": features,
      "8": features,
    });
    expect(values[parentKeys.shellChildren()]).toEqual(children);
  });

  it("reads nothing beyond the list for a child the list does not name", async () => {
    answers.delete("/parent/me/children/7/features");
    answers.delete("/parent/me/children/8/features");
    answers.delete("/parent/me/children/7/today");
    answers.delete("/parent/me/children/8/today");

    const seed = await loadParentPageSeed({ kind: "child", studentId: "99" });

    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      parentKeys.shellChildren(),
    ]);
  });

  it("waits in the child page's server render for the list only", async () => {
    const seed = await loadParentPageSeed({ kind: "child", studentId: "8" });

    expect(seed?.entries.map((entry) => [entry.key, entry.render])).toEqual([
      [parentKeys.shellChildren(), true],
      [parentKeys.features(children, TEST_CLOCK_TODAY), false],
      [parentKeys.today(children, TEST_CLOCK_TODAY), false],
    ]);
  });

  it("gives the shell the list and features without waiting", async () => {
    const seed = await loadParentShellSeed();

    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      parentKeys.shellChildren(),
      parentKeys.features(children, TEST_CLOCK_TODAY),
    ]);
    expect(seed?.entries.some((entry) => entry.render)).toBe(false);
  });

  it.each([
    ["no snapshot", null],
    [
      "a module not booked",
      { session: parent, accessToken: "t", notBooked: true },
    ],
    [
      "another portal's scope",
      {
        session: { ...parent, user: { id: "41", scope: "tenant" } },
        accessToken: "t",
        notBooked: false,
      },
    ],
  ])("seeds nothing for %s", async (_, current) => {
    snapshot.current = current;

    expect(await loadParentPageSeed({ kind: "start" })).toBeNull();
    expect(await loadParentShellSeed()).toBeNull();
  });

  it("classifies the parents' public pages like the auth guard", () => {
    for (const path of ["/login", "/parents/login", "/ferienkonto/abc"])
      expect(isProtectedParentPath(path)).toBe(false);
    for (const path of ["/", "/children/7", "/parents/messages"])
      expect(isProtectedParentPath(path)).toBe(true);
    expect(isProtectedParentPath(null)).toBe(false);
  });
});
