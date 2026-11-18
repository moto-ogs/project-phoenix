import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isSentryUserPseudonym } from "~/lib/sentry-user-pseudonym";
import { sentryUserPseudonym } from "./sentry-pseudonym";
import { serverSessionFromJwt } from "./session-callbacks";

describe("sentryUserPseudonym", () => {
  it("names one account always alike, as a pseudonym", () => {
    const pseudonym = sentryUserPseudonym("42");

    expect(isSentryUserPseudonym(pseudonym)).toBe(true);
    expect(sentryUserPseudonym("42")).toBe(pseudonym);
    expect(sentryUserPseudonym("43")).not.toBe(pseudonym);
  });

  // #3843: an unkeyed hash of a short numeric ID is reversed by hashing
  // every ID; without the secret no ID maps to the pseudonym.
  it("is not the ID or an unkeyed hash of it", () => {
    const pseudonym = sentryUserPseudonym("42");
    const unkeyed = (input: string) =>
      createHash("sha256").update(input).digest("hex").slice(0, 32);

    for (const input of ["42", "moto-sentry-user-v1\u000042"]) {
      expect(pseudonym).not.toBe(unkeyed(input));
    }
  });

  it("changes with the server secret", async () => {
    const pseudonym = sentryUserPseudonym("42");
    vi.resetModules();
    vi.doMock("~/env", () => ({ env: { NEXTAUTH_SECRET: "another-secret" } }));
    try {
      const rotated = await import("./sentry-pseudonym");
      expect(rotated.sentryUserPseudonym("42")).not.toBe(pseudonym);
    } finally {
      vi.doUnmock("~/env");
      vi.resetModules();
    }
  });

  it("names no one without an account ID", () => {
    expect(sentryUserPseudonym("")).toBeUndefined();
    expect(sentryUserPseudonym(undefined)).toBeUndefined();
  });
});

describe("serverSessionFromJwt", () => {
  const session = { expires: "2099-01-01T00:00:00.000Z", user: { id: "" } };

  it("gives a live and an ended session the account's pseudonym", () => {
    const live = serverSessionFromJwt({ id: "42", token: "access" }, session);
    const ended = serverSessionFromJwt(
      { id: "42", error: "RefreshTokenError" },
      session,
    );

    expect(live.user.sentryUserId).toBe(sentryUserPseudonym("42"));
    expect(ended.user.sentryUserId).toBe(sentryUserPseudonym("42"));
  });
});
