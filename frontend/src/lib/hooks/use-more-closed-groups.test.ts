import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useMoreClosedGroups } from "./use-more-closed-groups";

afterEach(() => {
  localStorage.clear();
});

describe("useMoreClosedGroups", () => {
  it("opens every section at first and remembers a closed one per school and account", () => {
    const first = renderHook(() => useMoreClosedGroups("schule", "7"));
    expect(first.result.current.isSectionOpen("tag")).toBe(true);
    expect(first.result.current.isSectionOpen("eltern")).toBe(true);

    act(() => first.result.current.toggleSection("eltern"));
    expect(first.result.current.isSectionOpen("eltern")).toBe(false);
    expect(localStorage.getItem("mehr-closed-groups:schule:7")).toBe(
      '["eltern"]',
    );
    first.unmount();

    const again = renderHook(() => useMoreClosedGroups("schule", "7"));
    expect(again.result.current.isSectionOpen("eltern")).toBe(false);
    expect(again.result.current.isSectionOpen("tag")).toBe(true);
    again.unmount();

    const colleague = renderHook(() => useMoreClosedGroups("schule", "8"));
    expect(colleague.result.current.isSectionOpen("eltern")).toBe(true);
  });
});
