import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signOut, useSession } = vi.hoisted(() => ({
  signOut: vi.fn(),
  useSession: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession }));
// Auth.js' signout protocol bound to the session mark (#8082).
vi.mock("~/lib/tenant-session-cookie", () => ({
  signOutSession: signOut,
}));
const { reloadDocument } = vi.hoisted(() => ({ reloadDocument: vi.fn() }));
vi.mock("~/lib/session-tree", () => ({ reloadDocument }));

import { renderHook } from "@testing-library/react";
import {
  signOutStaleSession,
  useLoginSessionCheck,
} from "./login-session-notice";

const stale = { error: "RefreshTokenExpired" } as unknown as Session;
const healthy = { user: { id: "1" } } as unknown as Session;

describe("signOutStaleSession", () => {
  const logger = { warn: vi.fn() };

  beforeEach(() => {
    signOut.mockReset();
    logger.warn.mockReset();
    reloadDocument.mockClear();
  });

  it("leaves a page without a stale session to its other checks at once", () => {
    const started = { current: false };
    for (const [status, session] of [
      ["loading", null],
      ["unauthenticated", null],
      ["authenticated", healthy],
    ] as const) {
      expect(
        signOutStaleSession({
          status,
          session,
          started,
          logger,
          portal: "tenant",
        }),
      ).toBeNull();
    }
    expect(signOut).not.toHaveBeenCalled();
    expect(started.current).toBe(false);
  });

  it("signs a stale session out once, without leaving the page", async () => {
    signOut.mockResolvedValue(undefined);
    const started = { current: false };
    const input = {
      status: "authenticated",
      session: stale,
      started,
      logger,
      portal: "tenant" as const,
    };

    const cleanup = signOutStaleSession({ ...input, status: "authenticated" });
    expect(
      signOutStaleSession({ ...input, status: "authenticated" }),
    ).toBeNull();
    await cleanup;

    expect(signOut).toHaveBeenCalledTimes(1);
    // The session the errored answer described: the exit keeps any other
    // (#8082).
    expect(signOut).toHaveBeenCalledWith("tenant", "");
    // A new document reads the cookie as it is now.
    expect(reloadDocument).toHaveBeenCalledTimes(1);
    expect(started.current).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports a failed sign-out and lets a later call try again", async () => {
    const cause = new Error("offline");
    signOut.mockRejectedValueOnce(cause).mockResolvedValueOnce(undefined);
    const started = { current: false };
    const onFailure = vi.fn();

    await signOutStaleSession({
      status: "authenticated",
      session: stale,
      started,
      logger,
      portal: "tenant",
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledWith(cause);
    expect(logger.warn).toHaveBeenCalledWith("stale_session_signout_failed", {
      error: "offline",
    });
    expect(started.current).toBe(false);
    await signOutStaleSession({
      status: "authenticated",
      session: stale,
      started,
      logger,
      portal: "tenant",
    });
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});

describe("signOutStaleSession and another tab's sign-in (#8082)", () => {
  const logger = { warn: vi.fn() };

  it("keeps a session another tab signed in with meanwhile and loads it", async () => {
    // signOutSession resolves when the exit kept another session.
    signOut.mockReset().mockResolvedValue(undefined);
    reloadDocument.mockClear();
    const onFailure = vi.fn();

    await signOutStaleSession({
      status: "authenticated",
      session: stale,
      started: { current: false },
      logger,
      portal: "tenant",
      onFailure,
    });

    // No failure: the cookie is the new session's, the next document reads it.
    expect(onFailure).not.toHaveBeenCalled();
    expect(reloadDocument).toHaveBeenCalledTimes(1);
  });
});

describe("useLoginSessionCheck", () => {
  // useSession's update() after a sign-in loads again; the step waiting for
  // it must stay on screen.
  it("keeps the check done when the session loads again", () => {
    useSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const onAccess = vi.fn();
    const { result, rerender } = renderHook(() =>
      useLoginSessionCheck({
        logger: { warn: vi.fn() },
        portal: "tenant",
        onAccess,
      }),
    );
    expect(result.current).toBe(false);

    useSession.mockReturnValue({ data: null, status: "loading" });
    rerender();

    expect(result.current).toBe(false);
    expect(onAccess).not.toHaveBeenCalled();
  });
});
