import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  catalogReads,
  profile,
} from "../../../e2e/network/catalog-fixtures.mjs";
import { portalRoutes } from "./portals.generated";

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
