import type { Session } from "next-auth";
import { describe, expect, it } from "vitest";
import { tenantPrefetchResources } from "./tenant-prefetch-resources";
import { groups } from "~/lib/swr/groups";

function context(permissions: string[], scope = "") {
  const session: Session = {
    expires: "2099-01-01",
    user: { id: "42", tenantId: "7", permissions, scope },
  };
  return {
    session,
    slug: "school-a",
    groupId: "7",
    groups: ["7"],
  };
}

describe("tenant destination resources", () => {
  it.each([
    "/students/search",
    "/school-a/students/search",
    "/students/search?group_id=7",
    "/active-supervisions",
    "/active-supervisions?session=9",
    "/active-supervisions?room=5",
  ])("leaves data for %s to its server page", async (href) => {
    expect(
      await tenantPrefetchResources(
        href,
        context(["users:read", "groups:read", "rooms:read"]),
      ),
    ).toEqual([]);
  });
  it("preloads only a shell-confirmed OGS group", async () => {
    const allowed = context(["users:read"]);
    expect(
      (await tenantPrefetchResources("/ogs-groups?group=7", allowed)).map(
        (resource) => resource.key,
      ),
    ).toEqual([groups.live("7")]);
    expect(
      await tenantPrefetchResources("/ogs-groups?group=8", allowed),
    ).toEqual([]);
    expect(
      (
        await tenantPrefetchResources("/ogs-groups", {
          ...allowed,
          groupId: null,
        })
      ).map((resource) => resource.key),
    ).toEqual([groups.live(null)]);
    expect(
      await tenantPrefetchResources("/ogs-groups", {
        ...allowed,
        groupId: null,
        groups: [],
      }),
    ).toEqual([]);
  });
  it.each([
    "/students/123",
    "/school-a/students/123",
    "/students/123?from=/students/search",
  ])(
    "does not perform the audited child read for %s on intent",
    async (href) => {
      expect(
        await tenantPrefetchResources(href, context(["users:read"])),
      ).toEqual([]);
    },
  );
  it("leaves other server-page data to the destination", async () => {
    const allowed = context(["users:read", "users:update"]);
    expect(await tenantPrefetchResources("/home", allowed)).toEqual([]);
    expect(await tenantPrefetchResources("/anfragen", allowed)).toEqual([]);
  });
  it.each([
    "/traeger/access-log",
    "/parents/holiday-preallocation",
    "https://example.invalid/home",
    "//example.invalid/home",
    "/another-school/students/search",
  ])("does not speculate about %s", async (href) => {
    expect(
      await tenantPrefetchResources(
        href,
        context(["users:read", "groups:read"]),
      ),
    ).toEqual([]);
  });
  it.each(["parent", "school", "org", "platform", "caterer"])(
    "rejects the %s portal even with matching permission claims",
    async (scope) => {
      expect(
        await tenantPrefetchResources(
          "/students/search",
          context(["users:read"], scope),
        ),
      ).toEqual([]);
    },
  );
});
