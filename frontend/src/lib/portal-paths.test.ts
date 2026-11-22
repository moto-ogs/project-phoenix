import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubPortalHostEnv } from "~/test/route-test-helpers";
import { configuredPortalOfHost, portalAuthAnswer } from "./portal-paths";

describe("configuredPortalOfHost", () => {
  beforeEach(() => stubPortalHostEnv());

  it.each([
    ["parents.localhost:3000", "parent"],
    ["schule.localhost", "school"],
    ["school-a.localhost:3000", "tenant"],
  ])("reads %s as %s", (host, portal) => {
    expect(configuredPortalOfHost(host)).toBe(portal);
  });

  it("refuses to decide while a portal host is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_CATERER_HOSTNAME", "");

    expect(() => configuredPortalOfHost("school-a.localhost:3000")).toThrow(
      "NEXT_PUBLIC_CATERER_HOSTNAME is not set",
    );
  });
});

describe("auth step envelope", () => {
  it("unwraps the backend answer of the steps the portal envelopes", () => {
    const body = { status: "mfa_required" };

    expect(
      portalAuthAnswer("operator", "login", { status: "success", data: body }),
    ).toBe(body);
  });

  it("passes other portals' backend answers as they are", () => {
    const body = { status: "mfa_required" };

    expect(portalAuthAnswer("school", "login", body)).toBe(body);
  });
});
