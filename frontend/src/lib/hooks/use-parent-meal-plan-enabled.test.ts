import { parentFamilyFixture } from "~/test/parent-family-fixture";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";
import { useInvalidateMatching } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import { listAnnouncements } from "~/lib/parent-api";
import { useParentMealPlanEnabled } from "./use-parent-meal-plan-enabled";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

const family = parentFamilyFixture();

vi.unmock("swr");
vi.mock("~/lib/tenant-context", () => ({ useTenantSlugSafe: () => null }));
vi.mock("~/lib/parent-api", () => ({
  getFamilyStart: vi.fn(),
  listAnnouncements: vi.fn(),
}));
const children = [
  { tenant_id: "1", student_id: "10" },
  { tenant_id: "1", student_id: "11" },
  { tenant_id: "2", student_id: "20" },
] as parentMeContract.ChildResponse[];
beforeEach(() => {
  vi.clearAllMocks();

  family.mockRead();
  family.children.mockResolvedValue(children);
  family.features.mockResolvedValue({
    meal_plan_enabled: false,
  } as parentMeContract.ChildFeaturesResponse);
  vi.mocked(listAnnouncements).mockResolvedValue([]);
});
function mount(enabled = true) {
  return renderHook(
    () => ({
      enabled: useParentMealPlanEnabled(enabled),
      refresh: useInvalidateMatching(),
    }),
    { wrapper: ParentResourceTestProvider },
  );
}
describe("useParentMealPlanEnabled with real SWR", () => {
  it("does not fetch in another portal or disabled mode", () => {
    const { result } = mount(false);
    expect(result.current.enabled).toBe(false);
    expect(family.children).not.toHaveBeenCalled();
    expect(family.features).not.toHaveBeenCalled();
  });
  it("checks every relationship, including siblings at the same school", async () => {
    family.features.mockImplementation(
      async (id) =>
        ({
          meal_plan_enabled: id === "11",
        }) as parentMeContract.ChildFeaturesResponse,
    );
    const { result } = mount();
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(family.features).toHaveBeenCalledTimes(3);
    expect(family.features).toHaveBeenCalledWith("10");
    expect(family.features).toHaveBeenCalledWith("11");
    expect(family.features).toHaveBeenCalledWith("20");
    expect(family.children).toHaveBeenCalledTimes(1);
  });
  it("stays hidden until availability is confirmed", async () => {
    const { result } = mount();
    await waitFor(() => expect(family.features).toHaveBeenCalledTimes(3));
    expect(result.current.enabled).toBe(false);
  });
  it("does not cache a failed lookup as false and recovers on revalidation", async () => {
    family.features.mockRejectedValue(new Error("offline"));
    const { result } = mount();
    await waitFor(() => expect(family.features).toHaveBeenCalledTimes(3));
    expect(result.current.enabled).toBe(false);
    family.features.mockResolvedValue({
      meal_plan_enabled: true,
    } as parentMeContract.ChildFeaturesResponse);
    await act(async () => {
      await result.current.refresh(parentKeys.isResource);
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });
  it("has no discoverable feature without children or feed", async () => {
    family.children.mockResolvedValue([]);
    const { result } = mount();
    await waitFor(() => expect(family.children).toHaveBeenCalledOnce());
    expect(result.current.enabled).toBe(false);
    expect(family.features).not.toHaveBeenCalled();
  });
});
