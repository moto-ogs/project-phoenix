import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseSession, mockSupervision, overviewScope } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockSupervision: vi.fn(),
  overviewScope: { current: "own" },
}));

vi.mock("next-auth/react", () => ({ useSession: mockUseSession }));
vi.mock("~/lib/auth-utils", () => ({
  hasEffectiveAdminScope: () => false,
  hasPermission: () => false,
  isCaregiver: () => true,
}));
vi.mock("~/lib/change-request-access", () => ({
  canOpenRequestsPage: () => false,
}));
vi.mock("~/lib/supervision-context", () => ({
  useOptionalSupervision: mockSupervision,
}));
vi.mock("~/lib/tenant-context", () => ({
  useOperationalOverviewScope: () => overviewScope.current,
}));

import { useHomeBlockAccess } from "./use-home-block-access";

describe("useHomeBlockAccess", () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({
      data: {
        user: { roles: ["user"], permissions: ["groups:read"] },
        expires: "2099-01-01",
      },
      status: "authenticated",
      update: vi.fn(),
    });
    overviewScope.current = "own";
  });

  // #2380, #8134: ohne Adminzuschnitt sieht die Person die Blöcke der ganzen
  // Schule nur an einer Schule mit schulweiter Übersicht.
  it("sees all blocks of the school only under the school-wide overview", () => {
    mockSupervision.mockReturnValue({ hasGroups: false, groups: [] });

    expect(renderHook(() => useHomeBlockAccess()).result.current).toMatchObject(
      { seesAllBlocks: false },
    );

    overviewScope.current = "all_staff";
    expect(renderHook(() => useHomeBlockAccess()).result.current).toMatchObject(
      { seesAllBlocks: true },
    );
  });

  it("does not treat a visible tenant group as an own assignment", () => {
    mockSupervision.mockReturnValue({
      hasGroups: true,
      groups: [
        {
          id: "7",
          name: "Sonnengruppe",
          is_personal: false,
        },
      ],
    });

    const { result } = renderHook(() => useHomeBlockAccess());

    expect(result.current.hasOwnGroups).toBe(false);
  });

  it("enables the card for a personally assigned group", () => {
    mockSupervision.mockReturnValue({
      hasGroups: true,
      groups: [
        {
          id: "8",
          name: "Sternengruppe",
          is_personal: true,
        },
      ],
    });

    const { result } = renderHook(() => useHomeBlockAccess());

    expect(result.current.hasOwnGroups).toBe(true);
  });

  it("keeps the card hidden until the server confirms the assignment", () => {
    mockSupervision.mockReturnValue({
      hasGroups: true,
      groups: [{ id: "9", name: "Mondgruppe" }],
    });

    const { result } = renderHook(() => useHomeBlockAccess());

    expect(result.current.hasOwnGroups).toBe(false);
  });
});
