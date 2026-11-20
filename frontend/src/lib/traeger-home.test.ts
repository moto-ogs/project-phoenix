import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import { traegerNavGroupsFor } from "~/components/traeger/shell/traeger-nav-items";

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));
vi.mock("next-auth/react", () => ({ getSession: mockGetSession }));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

import { fetchTraegerHomeHref, traegerHomePath } from "./traeger-home";

function sessionWith(permissions: string[]): Session {
  return {
    user: { id: "1", scope: "org", permissions },
    expires: "2099-01-01T00:00:00Z",
  } as unknown as Session;
}

describe("traegerHomePath", () => {
  it("starts on the dashboard with its right (#7646)", () => {
    expect(traegerHomePath(sessionWith(["traeger_overview:read"]))).toBe(
      "/traeger/uebersicht",
    );
  });

  it("starts on the school list without the dashboard right", () => {
    expect(traegerHomePath(sessionWith(["traeger_staff:manage"]))).toBe(
      "/traeger",
    );
    expect(traegerHomePath(sessionWith([]))).toBe("/traeger");
  });

  it("starts on the school list while the session is unknown", () => {
    expect(traegerHomePath(null)).toBe("/traeger");
  });

  it("starts on the dashboard exactly when the navigation shows it", () => {
    for (const permissions of [
      [],
      ["traeger_overview:read"],
      ["traeger_billing:manage"],
      ["admin:*"],
    ]) {
      const session = sessionWith(permissions);
      const showsDashboard = traegerNavGroupsFor(session).some((group) =>
        group.items.some((item) => item.href === "/traeger/uebersicht"),
      );
      expect(traegerHomePath(session) === "/traeger/uebersicht").toBe(
        showsDashboard,
      );
    }
  });
});

describe("fetchTraegerHomeHref", () => {
  it("reads the new session once without telling other tabs", async () => {
    mockGetSession.mockResolvedValue(sessionWith(["traeger_overview:read"]));
    await expect(fetchTraegerHomeHref()).resolves.toBe("/traeger/uebersicht");
    expect(mockGetSession).toHaveBeenCalledWith({ broadcast: false });
  });

  it("does not wait for a session that never answers", async () => {
    vi.useFakeTimers();
    mockGetSession.mockReturnValue(new Promise(() => undefined));
    const href = fetchTraegerHomeHref();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(href).resolves.toBe("/traeger");
  });
});
