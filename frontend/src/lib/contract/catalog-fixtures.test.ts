import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  catalogReads,
  familyStart,
  loginAnswer,
  parentChildren,
  profile,
  sessionClaims,
  staffPreviewCandidates,
} from "../../../e2e/network/catalog-fixtures.mjs";
import { routes as sessionRoutes } from "./auth-session.generated";
import { LoginResponseSchema } from "./shared.generated";
import { portalRoutes } from "./portals.generated";
import { TEST_CLOCK_TODAY } from "~/test/clock";

// The fake backend of the network E2E suites answers through the catalog
// proxy, which refuses an answer its contract does not decode (502). Those
// suites run only nightly; this check catches a contract change in PR CI.
const getRoutes = Object.values(portalRoutes)
  .flat()
  .filter((route) => route.method === "GET");

const routeFor = (path: string) =>
  getRoutes.find((route) => route.pattern.replace(/\/$/, "") === path);

const answers: [string, unknown][] = [
  ...catalogReads,
  ["/api/me/profile", profile],
  ["/parent/me/children", parentChildren],
  ["/parent/me/family-start", familyStart(parentChildren, TEST_CLOCK_TODAY)],
  ["/auth/staff-preview/candidates", staffPreviewCandidates],
];

describe("fake backend answers of the network E2E suites", () => {
  it.each(answers)("%s decodes against its contract", (path, data) => {
    const route = routeFor(path);
    expect(route, `no GET route in the contract for ${path}`).toBeDefined();
    // Catalog routes carry one decoder, not a set of variants.
    const decoder = route?.response as z.ZodType | undefined;
    const parsed = decoder?.safeParse({ status: "success", data });
    expect(parsed?.success, JSON.stringify(parsed?.error?.issues)).toBe(true);
  });
});

// The session steps decode in the portal's route files, not the proxy; a
// drift there failed every login of the nightly suites (#8082).
describe("fake backend session answers of the network E2E suites", () => {
  it("a login answer decodes as LoginResponse", () => {
    const parsed = LoginResponseSchema.safeParse(loginAnswer("token"));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it.each(["", "parent", "school", "platform", "caterer"])(
    "session claims of scope %j decode as the validation answer",
    (scope) => {
      const decoder = sessionRoutes["POST /auth/session/validate"].response;
      const parsed = decoder.safeParse({
        ...sessionClaims({ scope, account: "2", tenant: "2", now: 1 }),
        family_id: "family-1",
      });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    },
  );
});
