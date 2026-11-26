import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Session } from "next-auth";

const session = vi.hoisted(() => ({ current: null as Session | null }));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session.current }),
}));
vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/test-tenant${path}`,
}));

import {
  useCarePlanTodayTarget,
  useDayPlanHref,
  useDayPlanLabel,
} from "./use-day-plan-href";

function withRoles(roles: string[], permissions: string[] = []): Session {
  return {
    user: { id: "1", roles, permissions },
    expires: "2099-12-31",
  } as unknown as Session;
}

/**
 * Die Seitenleiste blendet den Tagesplan für reine Adminkonten aus
 * (`hideForAdmin`) — sie arbeiten im Betreuungsplan direkt darunter. Ein
 * Weiterlink der Startseite darf nicht auf eine Seite zeigen, die diese
 * Person in ihrer Navigation gar nicht hat.
 */
describe("useDayPlanHref (#2180)", () => {
  it("führt eine Betreuungskraft in den Tagesplan", () => {
    session.current = withRoles(["user"]);

    expect(renderHook(() => useDayPlanHref()).result.current).toBe(
      "/test-tenant/tagesplan",
    );
    expect(renderHook(() => useDayPlanLabel()).result.current).toBe(
      "Heute öffnen",
    );
  });

  it("führt ein reines Adminkonto in den Betreuungsplan", () => {
    session.current = withRoles(["admin"], ["admin:*"]);

    expect(renderHook(() => useDayPlanHref()).result.current).toBe(
      "/test-tenant/betreuungsplan",
    );
    expect(renderHook(() => useDayPlanLabel()).result.current).toBe(
      "Zum Betreuungsplan",
    );
  });

  // Wer beides ist, sieht den Tagesplan auch in der Seitenleiste.
  it("führt eine Leitung, die auch betreut, in den Tagesplan", () => {
    session.current = withRoles(["admin", "user"], ["admin:*"]);

    expect(renderHook(() => useDayPlanHref()).result.current).toBe(
      "/test-tenant/tagesplan",
    );
  });
});

describe("useCarePlanTodayTarget (#8134)", () => {
  const block = { date: "2026-09-09", id: "86" };
  const target = () =>
    renderHook(() => useCarePlanTodayTarget()).result.current;

  it("führt die Leitung in den Tag und in den Termin im Betreuungsplan", () => {
    session.current = withRoles(["admin"], ["admin:*"]);

    expect(target().opensPlan).toBe(true);
    expect(target().dayHref("2026-09-09")).toBe(
      "/test-tenant/betreuungsplan?view=tag&d=2026-09-09",
    );
    // Ohne Datum: die Tagesansicht zeigt von selbst heute.
    expect(target().dayHref()).toBe("/test-tenant/betreuungsplan?view=tag");
    expect(target().blockHref(block)).toBe(
      "/test-tenant/betreuungsplan?view=tag&d=2026-09-09&block=86",
    );
  });

  // Die Leseansicht (#2283) zeigt denselben Termin: wer Plan und Team lesen
  // darf, landet dort, auch ohne schedules:manage.
  it("führt das Team mit Leserecht in die Leseansicht des Plans", () => {
    session.current = withRoles(["user"], ["schedules:read", "users:read"]);

    expect(target().opensPlan).toBe(true);
    expect(target().blockHref(block)).toBe(
      "/test-tenant/betreuungsplan?view=tag&d=2026-09-09&block=86",
    );
  });

  it("führt eine Leitungsrolle der Schule mit schedules:manage in den Plan", () => {
    session.current = withRoles(["leitung"], ["schedules:manage"]);

    expect(target().opensPlan).toBe(true);
  });

  // ADR 0091: die AG-Leitung hält schedules:read allein und hat den
  // schulweiten Plan nicht als Seite.
  it("lässt die AG-Leitung im Tagesplan", () => {
    session.current = withRoles(["ag-leitung"], ["schedules:read"]);

    expect(target().opensPlan).toBe(false);
    expect(target().dayHref("2026-09-09")).toBe("/test-tenant/tagesplan");
    expect(target().blockHref(block)).toBe("/test-tenant/tagesplan");
  });
});
