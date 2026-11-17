import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMessagesUnread } from "./use-messages-unread";

const { state, useUnreadCount } = vi.hoisted(() => ({
  state: {
    elternAppBooked: true,
    messagingEnabled: true,
  },
  useUnreadCount: vi.fn(() => ({
    unreadCount: 0,
    isLoading: false,
    refresh: vi.fn(),
  })),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "account-1" } },
    status: "authenticated",
  }),
}));

vi.mock("~/lib/auth-utils", () => ({ hasPermission: () => true }));
vi.mock("~/lib/parent-messages-api", () => ({
  fetchUnreadCount: vi.fn(),
}));
vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuth: () => ({ mode: "teacher" }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useModuleBooked: () => state.elternAppBooked,
  useTenantSafe: () => ({
    tenant: { messagingEnabled: state.messagingEnabled },
  }),
}));
vi.mock("./use-unread-count", () => ({ useUnreadCount }));

describe("useMessagesUnread", () => {
  beforeEach(() => {
    state.elternAppBooked = true;
    state.messagingEnabled = true;
    useUnreadCount.mockClear();
  });

  // The tenant layout seeds this key from the server (shellOwnedEntries);
  // only an enabled reader shows the seed.
  it("reads the server-seeded key when parent messaging is available", () => {
    renderHook(() => useMessagesUnread());

    expect(useUnreadCount).toHaveBeenCalledWith(
      "badge-messages-unread:account-1",
      expect.objectContaining({ enabled: true }),
    );
  });

  it("does not read the seed without the Eltern-App module", () => {
    state.elternAppBooked = false;

    renderHook(() => useMessagesUnread());

    expect(useUnreadCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });

  it("does not read the seed while parent messaging is disabled", () => {
    state.messagingEnabled = false;

    renderHook(() => useMessagesUnread());

    expect(useUnreadCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });
});
