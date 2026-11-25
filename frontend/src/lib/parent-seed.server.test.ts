import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTestClock, TEST_CLOCK_TODAY } from "~/test/clock";
import type { ServerSeed } from "~/lib/swr/server-seed";

const { answers, requests, snapshot } = vi.hoisted(() => ({
  requests: [] as string[],
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
    requests.push(endpoint);
    const answer = answers.get(endpoint);
    if (!answer) throw new Error(`unrouted ${endpoint}`);
    return Response.json(answer.body, { status: answer.status });
  },
}));
vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: async () => snapshot.current,
}));

import { isProtectedParentPath, parentSeedProps } from "./parent-seed.server";
import { parentInboxKeys } from "~/lib/swr/parent-inbox-keys";
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

const endpoint = "/parent/me/family-start";
const key = parentKeys.familyStart(TEST_CLOCK_TODAY);
const cards = children.map((child) => ({
  child,
  access_version: "v1",
  features,
  today: { at_ogs: true, state: "present" },
}));
const response = { day: TEST_CLOCK_TODAY, day_remaining_seconds: 3600, cards };

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
  requests.length = 0;
  answers.set(endpoint, ok(response));
});

describe("parent page seeds", () => {
  it.each([true, false])(
    "offers one family read with render=%s, independent of the URL",
    async (render) => {
      const seed = await parentSeedProps(render, {
        kind: "child",
        studentId: "99",
      }).seed;
      expect(seed?.generation).toBe(sessionGeneration(parent));
      expect(seed?.entries.map((entry) => [entry.key, entry.render])).toEqual([
        [key, render],
      ]);
      expect((await valuesOf(seed))[key]).toMatchObject({
        children,
        features: { "7": features, "8": features },
        confirmedToday: { "7": true, "8": true },
      });
      // No child from the URL, and no individual child read.
      expect(requests).toEqual([endpoint]);
    },
  );

  it("seeds only news availability for the shell, not the feed", async () => {
    answers.set("/parent/me/news", ok([]));
    const shell = await valuesOf(await parentSeedProps(false).seed);
    expect(shell[parentKeys.newsAvailable()]).toBe(false);
    expect(shell[parentKeys.announcements()]).toBeUndefined();

    answers.set("/parent/me/news", { status: 503, body: { status: "error" } });
    const refused = await valuesOf(await parentSeedProps(false).seed);
    expect(refused[parentKeys.newsAvailable()]).toBeUndefined();
  });

  it("seeds successful siblings and serializable partial errors, not a second read", async () => {
    answers.set(
      endpoint,
      ok({ ...response, cards: [cards[0], { ...cards[1], today: null }] }),
    );
    const values = await valuesOf(
      await parentSeedProps(true, { kind: "child", studentId: "99" }).seed,
    );
    expect(values[key]).toMatchObject({
      today: { "7": { state: "present" }, "8": { state: "unknown" } },
      todayErrors: { "8": { status: 503, code: "general.unavailable" } },
      features: { "7": features, "8": features },
      confirmedToday: { "7": true, "8": false },
    });
    expect(JSON.parse(JSON.stringify(values[key]))).toEqual(values[key]);
    expect(requests).toEqual([endpoint]);
  });

  it("leaves a failed read unseeded rather than confirming an empty family", async () => {
    answers.set(endpoint, { status: 503, body: { status: "error" } });
    expect(
      (
        await valuesOf(
          await parentSeedProps(true, { kind: "child", studentId: "99" }).seed,
        )
      )[key],
    ).toBeUndefined();
    expect(requests).toEqual([endpoint]);
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

    expect(
      await parentSeedProps(true, { kind: "child", studentId: "99" }).seed,
    ).toBeNull();
    expect(await parentSeedProps(false).seed).toBeNull();
    expect(requests).toEqual([]);
  });

  it("loads only the confirmed child's care keys and keeps independent successes", async () => {
    const prefix = "/parent/me/children/8";
    answers.set(`${prefix}/sick-note`, ok([]));
    answers.set(`${prefix}/excused-requests`, {
      status: 403,
      body: { status: "error", code: "care.guardian_permission_denied" },
    });
    answers.set(`${prefix}/parent-conferences`, ok([]));

    const values = await valuesOf(
      await parentSeedProps(true, { kind: "child", studentId: "8" }).seed,
    );
    expect(values[parentKeys.sickDays("8", TEST_CLOCK_TODAY)]).toEqual([]);
    expect(values[parentKeys.conferences("8")]).toEqual([]);
    expect(
      values[parentKeys.excusedRequests("8", TEST_CLOCK_TODAY)],
    ).toBeUndefined();
    expect(requests).toEqual(
      expect.arrayContaining([
        endpoint,
        `${prefix}/care-exception`,
        `${prefix}/care-schedule`,
        `${prefix}/pickup-change-requests`,
        `${prefix}/care-offerings`,
        `${prefix}/courses`,
      ]),
    );
    expect(
      requests.some((path) => path.startsWith("/parent/me/children/7/")),
    ).toBe(false);
    expect(requests).not.toContain(`${prefix}/guardians`);
    expect(requests).not.toContain(`${prefix}/care-offerings/catalog`);
  });

  it("selects the eligible family school's meal plan for the rendered week", async () => {
    setTestClock(new Date("2026-09-10T10:00:00.000Z"));
    const monday = "2026-09-14";
    const plan = `/parent/me/children/8/meal-plan?week_start=${monday}`;
    answers.set(
      endpoint,
      ok({
        ...response,
        cards: [
          cards[0],
          { ...cards[1], features: { ...features, meal_plan_enabled: true } },
        ],
      }),
    );
    answers.set(plan, ok([]));

    const values = await valuesOf(
      await parentSeedProps(true, { kind: "meal", week: monday, school: "99" })
        .seed,
    );
    expect(values[parentInboxKeys.mealPlan("8", monday)]).toEqual([]);
    expect(requests).toEqual([endpoint, plan]);
  });

  it("loads conversation summaries without opening either thread", async () => {
    answers.set("/parent/me/messages/children/7/threads", ok([]));
    const conversation = await valuesOf(
      await parentSeedProps(false, { kind: "conversation", studentId: "7" })
        .seed,
    );
    await valuesOf(await parentSeedProps(false, { kind: "groupThread" }).seed);
    expect(conversation[parentInboxKeys.childThreads("7")]).toEqual([]);
    expect(requests).not.toContain("/parent/me/messages/children/7");
    expect(
      requests.some((path) =>
        path.startsWith("/parent/me/messages/group-threads/"),
      ),
    ).toBe(false);
  });

  it("classifies the parents' public pages like the auth guard", () => {
    for (const path of ["/login", "/parents/login", "/ferienkonto/abc"])
      expect(isProtectedParentPath(path)).toBe(false);
    for (const path of ["/", "/children/7", "/parents/messages"])
      expect(isProtectedParentPath(path)).toBe(true);
    expect(isProtectedParentPath(null)).toBe(false);
  });
});
