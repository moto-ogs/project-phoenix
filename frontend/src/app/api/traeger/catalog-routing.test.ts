import { readdirSync } from "node:fs";
import path from "node:path";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex";
import { getSortedRoutes } from "next/dist/shared/lib/router/utils/sorted-routes";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { suppressConsole } from "~/test/helpers/console";

vi.mock("~/server/auth/traeger", async () => {
  const { mockPortalModule } = await import("~/test/portal-binding");
  return mockPortalModule("traeger", {
    auth: async () => ({ user: { token: "traeger-token" } }),
  });
});
vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://localhost:8080",
}));

const fetchMock = vi.fn<typeof fetch>();
const directory = path.dirname(new URL(import.meta.url).pathname);
const routes = getSortedRoutes(
  readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => path.basename(file) === "route.ts")
    .map(
      (file) => `/api/traeger/${path.dirname(file).split(path.sep).join("/")}`,
    ),
);

// Use Next's precedence and parameter extraction on the real route tree,
// rather than importing the catch-all handler the request might never reach.
async function get(pathname: string) {
  for (const route of routes) {
    const params = getRouteMatcher(getRouteRegex(route))(pathname);
    if (!params) continue;
    const file = path.join(
      directory,
      route.slice("/api/traeger/".length),
      "route.ts",
    );
    const { GET } = await import(file);
    return GET(new NextRequest(`http://localhost:3000${pathname}`), {
      params: Promise.resolve(params),
    }) as Promise<Response>;
  }
  throw new Error(`No route for ${pathname}`);
}

const pathname = "/api/traeger/billing-families/debtor-number-format";
const settings = {
  digits_only: true,
  min_digits: 4,
  max_digits: 10,
  scope: "payer",
};

describe("Träger catalog route selection", () => {
  suppressConsole("error");

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("strips unknown fields through the selected route's catalog decoder", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: "success",
        data: { ...settings, internal: true },
      }),
    );

    const response = await get(pathname);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(settings);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/traeger/billing-families/debtor-number-format",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rejects malformed backend data through the selected route with 502", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: "success",
        data: { ...settings, min_digits: "4" },
      }),
    );

    const response = await get(pathname);

    expect(response.status).toBe(502);
    // The cache policy comes from the portal's real binding, which this file
    // mocks: server/auth/portal-cache-control.test.ts asserts it for this path.
  });
});
