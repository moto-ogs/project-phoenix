import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ setUser: vi.fn(), setTags: vi.fn() }));

const { sentrySessionContext } = await import("./sentry-context");

// A pseudonym as the session callback derives it (#3843).
const PSEUDONYM = "0123456789abcdef0123456789abcdef";

describe("sentrySessionContext", () => {
  it("gives an OGS staff session its pseudonym, role and school", () => {
    expect(
      sentrySessionContext("tenant", {
        id: "42",
        sentryUserId: PSEUDONYM,
        scope: "",
        tenantId: 12,
      }),
    ).toEqual({ user: { id: PSEUDONYM }, role: "staff", schoolId: "12" });
  });

  it("never names the account ID, not even without a pseudonym", () => {
    expect(sentrySessionContext("tenant", { id: "42", tenantId: 12 })).toEqual({
      user: null,
      role: "staff",
      schoolId: "12",
    });
    for (const sentryUserId of ["42", "", "0123456789ABCDEF0123456789ABCDEF"]) {
      expect(
        sentrySessionContext("parent", { id: "42", sentryUserId }).user,
      ).toBeNull();
    }
  });

  it("names leadership, the staff preview and carrier sessions coarsely", () => {
    const admin = { id: "1", tenantId: 3, isAdmin: true };
    const preview = { id: "1", tenantId: 3, isPreview: true };
    const carrier = {
      id: "2",
      sentryUserId: PSEUDONYM,
      tenantId: 3,
      scope: "org",
    };

    expect(sentrySessionContext("tenant", admin).role).toBe("admin");
    expect(sentrySessionContext("tenant", preview).role).toBe("admin");
    expect(sentrySessionContext("tenant", carrier)).toEqual({
      user: { id: PSEUDONYM },
      role: "carrier",
      schoolId: "3",
    });
  });

  it("binds a school portal session to its school", () => {
    expect(
      sentrySessionContext("school", {
        id: "5",
        sentryUserId: PSEUDONYM,
        scope: "school",
        tenantId: 8,
      }),
    ).toEqual({ user: { id: PSEUDONYM }, role: "lehrkraft", schoolId: "8" });
  });

  it("leaves school_id out for operator sessions", () => {
    expect(
      sentrySessionContext("operator", {
        id: "7",
        sentryUserId: PSEUDONYM,
        scope: "platform",
      }),
    ).toEqual({ user: { id: PSEUDONYM }, role: "operator", schoolId: null });
  });

  it("leaves school_id out for parent sessions, whatever the token carries", () => {
    expect(
      sentrySessionContext("parent", {
        id: "9",
        sentryUserId: PSEUDONYM,
        scope: "parent",
        tenantId: 0,
      }),
    ).toEqual({ user: { id: PSEUDONYM }, role: "guardian", schoolId: null });
    expect(
      sentrySessionContext("parent", { id: "9", scope: "parent", tenantId: 4 })
        .schoolId,
    ).toBeNull();
  });

  it("has no school without a tenant ID and nothing without a session", () => {
    expect(sentrySessionContext("tenant", { id: "42" }).schoolId).toBeNull();
    expect(sentrySessionContext("tenant", null)).toEqual({
      user: null,
      role: null,
      schoolId: null,
    });
  });
});
