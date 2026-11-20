import type { Session } from "next-auth";
import { describe, expect, it } from "vitest";
import { traegerNavGroupsFor } from "~/components/traeger/shell/traeger-nav-items";
import { traegerHomePath } from "./traeger-home";

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
