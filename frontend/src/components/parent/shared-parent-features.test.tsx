import { parentFamilyFixture } from "~/test/parent-family-fixture";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";
import * as api from "~/lib/parent-api";
import { useDiscardRefusedEntity } from "~/lib/swr/hooks";
import {
  useParentFeatures,
  useParentToday,
} from "~/lib/hooks/use-parent-resources";
import { ApiError, apiErrorFromResponse } from "~/lib/api-error";
import {
  clearRateLimitBackoff,
  installRateLimitFetchGuard,
} from "~/lib/rate-limit-backoff";
import { releaseFakeTimers } from "~/test/clock";
import { useChildCare } from "./child-care";
import { useChildMasterData } from "./child-master-data";
import {
  SharedParentFeaturesProvider,
  useSharedParentFeatures,
} from "./child-requests-context";
const family = parentFamilyFixture();

vi.unmock("swr");
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => null,
  useTenantSafe: () => null,
}));

const children = [
  { student_id: "42", tenant_id: "7" },
] as parentMeContract.ChildResponse[];
const features = {
  sick_note_enabled: true,
  master_data_edit_enabled: true,
} as parentMeContract.ChildFeaturesResponse;
function wrapper({ children: content }: Readonly<{ children: ReactNode }>) {
  return (
    <ParentResourceTestProvider>
      <SharedParentFeaturesProvider linkedChildren={children}>
        {content}
      </SharedParentFeaturesProvider>
    </ParentResourceTestProvider>
  );
}
beforeEach(() => {
  vi.restoreAllMocks();

  family.mockRead();
  family.children.mockResolvedValue(children);
  family.features.mockResolvedValue(features);
  vi.spyOn(api, "getChildMasterData").mockResolvedValue(
    {} as parentMeContract.MasterDataResponse,
  );
  vi.spyOn(api, "getChildCareSchedule").mockResolvedValue({
    weekdays: [],
    today_absent: false,
  } as unknown as parentMeContract.CareScheduleResponse);
  vi.spyOn(api, "listSickDays").mockResolvedValue([]);
  vi.spyOn(api, "listExcusedRequests").mockResolvedValue([]);
  vi.spyOn(api, "listCareExceptions").mockResolvedValue([]);
  vi.spyOn(api, "listPickupChangeRequests").mockResolvedValue([]);
  // useParentToday loads beside the features; tests that assert it override this.
  family.today.mockResolvedValue(api.UNKNOWN_CHILD_TODAY);
});
function mount() {
  return renderHook(
    () => ({
      care: useChildCare("42"),
      master: useChildMasterData("42"),
      shared: useSharedParentFeatures(),
    }),
    { wrapper },
  );
}

describe("shared parent relationship features", () => {
  it("shares the confirmed flags between care and master-data sections", async () => {
    const { result } = mount();
    await waitFor(() =>
      expect(result.current.master.features).toEqual(features),
    );
    expect(result.current.care.features).toEqual(features);
    expect(family.features).toHaveBeenCalledTimes(1);
  });
  it("retries shared flags from care and clears the master-data error after recovery", async () => {
    family.features.mockRejectedValue(
      new ApiError("offline", 503, { code: "general.unavailable" }),
    );
    const { result } = mount();
    await waitFor(() => expect(result.current.master.error).not.toBeNull());
    expect(result.current.care.features.sick_note_enabled).toBe(false);
    family.features.mockResolvedValue(features);
    await act(async () => {
      result.current.care.refresh();
    });
    await waitFor(() =>
      expect(result.current.master.features).toEqual(features),
    );
    expect(result.current.master.error).toBeNull();
    expect(result.current.care.features).toEqual(features);
  });
  it("keeps confirmed capabilities when background revalidation fails without access refusal", async () => {
    const { result } = mount();
    await waitFor(() =>
      expect(result.current.master.features).toEqual(features),
    );
    expect(result.current.care.features.sick_note_enabled).toBe(true);
    family.features.mockRejectedValue(
      new ApiError("offline", 503, { code: "general.unavailable" }),
    );
    await act(async () => {
      result.current.care.refresh();
    });
    await waitFor(() =>
      expect(result.current.shared?.error).toMatchObject({
        code: "general.unavailable",
      }),
    );
    expect(result.current.master.error).toBeNull();
    expect(result.current.master.features).toEqual(features);
    expect(result.current.care.features.sick_note_enabled).toBe(true);
  });
  it("keeps another child's confirmed features when one relationship lookup fails", async () => {
    family.features.mockImplementation(async (id) => {
      if (id === "42")
        throw new ApiError("offline", 503, { code: "general.unavailable" });
      return features;
    });
    const linked = [
      ...children,
      { student_id: "43", tenant_id: "7" } as parentMeContract.ChildResponse,
    ];
    family.children.mockResolvedValue(linked);
    const { result } = renderHook(
      () => ({
        features: useParentFeatures(linked),
        discard: useDiscardRefusedEntity(),
      }),
      { wrapper: ParentResourceTestProvider },
    );
    await waitFor(() =>
      expect(result.current.features.data?.["43"]).toEqual(features),
    );
    expect(result.current.features.data?.["42"]).toBeUndefined();
    expect(result.current.features.error).toMatchObject({
      code: "general.unavailable",
    });
    family.features.mockReturnValue(new Promise(() => undefined));
    act(() => {
      result.current.discard(
        new ApiError("gone", 403, { code: "care.child_not_linked" }),
        {
          codes: ["care.child_not_linked"],
          matches: (key) => key.startsWith("parent-family-start-"),
        },
      );
    });
    expect(result.current.features.data).toBeUndefined();
  });
});

describe("shared parent daily status", () => {
  const linked = [
    ...children,
    { student_id: "43", tenant_id: "7" } as parentMeContract.ChildResponse,
  ];
  beforeEach(() => {
    family.children.mockResolvedValue(linked);
  });
  const present: parentMeContract.TodayStatusResponse = {
    at_ogs: true,
    state: "present",
  };
  const left: parentMeContract.TodayStatusResponse = {
    at_ogs: false,
    state: "left",
  };
  const failure = new ApiError("offline", 503, { code: "general.unavailable" });

  it("keeps successful sibling statuses and exposes cold-load failures", async () => {
    family.today.mockImplementation(async (id) => {
      if (id === "42") throw failure;
      return present;
    });
    const { result } = renderHook(() => useParentToday(linked), {
      wrapper: ParentResourceTestProvider,
    });
    await waitFor(() =>
      expect(result.current.error).toMatchObject({ code: failure.code }),
    );
    expect(result.current.data).toEqual({
      "42": api.UNKNOWN_CHILD_TODAY,
      "43": present,
    });
  });

  it("keeps confirmed attendance for failed children while updating successful siblings", async () => {
    const request = family.today.mockResolvedValue(present);
    const { result } = renderHook(() => useParentToday(linked), {
      wrapper: ParentResourceTestProvider,
    });
    await waitFor(() => expect(result.current.data?.["42"]).toEqual(present));
    request.mockImplementation(async (id) => {
      if (id === "42") throw failure;
      return left;
    });
    await act(async () => {
      await result.current.mutate();
    });
    expect(result.current.error).toMatchObject({ code: failure.code });
    expect(result.current.data).toEqual({
      "42": present,
      "43": left,
    });
    request.mockResolvedValue(left);
    await act(async () => {
      await result.current.mutate();
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toEqual({ "42": left, "43": left });
  });

  it("withdraws all projections when the family read refuses access", async () => {
    family.today.mockResolvedValue(present);
    const { result } = renderHook(
      () => ({
        today: useParentToday(linked),
        features: useParentFeatures(linked),
      }),
      { wrapper: ParentResourceTestProvider },
    );
    await waitFor(() =>
      expect(result.current.features.data?.["43"]).toEqual(features),
    );
    await waitFor(() =>
      expect(result.current.today.data?.["43"]).toEqual(present),
    );
    // The full response fails at the relationship gate, not once per child.
    vi.mocked(api.getFamilyStart)
      .mockRejectedValueOnce(
        new ApiError("gone", 403, { code: "care.child_not_linked" }),
      )
      .mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      await result.current.today.mutate();
    });
    expect(result.current.features.data).toBeUndefined();
    expect(result.current.today.data).toBeUndefined();
  });

  it("withdraws partial statuses when relationship access is refused", async () => {
    family.today.mockImplementation(async (id) => {
      if (id === "42") throw failure;
      return present;
    });
    const { result } = renderHook(
      () => ({
        today: useParentToday(linked),
        discard: useDiscardRefusedEntity(),
      }),
      { wrapper: ParentResourceTestProvider },
    );
    await waitFor(() =>
      expect(result.current.today.data?.["43"]).toEqual(present),
    );
    family.today.mockReturnValue(new Promise(() => undefined));
    act(() => {
      result.current.discard(
        new ApiError("gone", 403, { code: "care.child_not_linked" }),
        {
          codes: ["care.child_not_linked"],
          matches: (key) => key.startsWith("parent-family-start-"),
        },
      );
    });
    expect(result.current.today.data).toBeUndefined();
  });
});

describe("shared parent rate-limit recovery", () => {
  let restoreFetchGuard: (() => void) | undefined;
  afterEach(() => {
    restoreFetchGuard?.();
    vi.restoreAllMocks();
    clearRateLimitBackoff();
    releaseFakeTimers();
  });

  it("automatically restores features and daily statuses after the read quota recovers", async () => {
    vi.useFakeTimers();
    const previousFetch = window.fetch;
    window.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "10" },
        }),
      );
    const restore = installRateLimitFetchGuard();
    restoreFetchGuard = () => {
      restore();
      window.fetch = previousFetch;
    };
    const present: parentMeContract.TodayStatusResponse = {
      at_ogs: true,
      state: "present",
    };
    family.today.mockResolvedValue(present);
    vi.mocked(api.getFamilyStart).mockImplementation(async () => {
      const reply = await fetch("/api/parent/me/family-start");
      if (!reply.ok)
        throw await apiErrorFromResponse(reply, "Family unavailable");
      return family.read();
    });
    const { result } = renderHook(
      () => ({
        features: useParentFeatures(children),
        today: useParentToday(children),
      }),
      { wrapper: ParentResourceTestProvider },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.features.error).toMatchObject({ status: 429 });
    expect(result.current.today.error).toMatchObject({ status: 429 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_050);
    });
    expect(result.current.features.data).toEqual({ "42": features });
    expect(result.current.today.data).toEqual({ "42": present });
    expect(result.current.features.error).toBeUndefined();
    expect(result.current.today.error).toBeUndefined();
  });
});

describe("alternating partial parent refreshes", () => {
  const linked = [
    ...children,
    { student_id: "43", tenant_id: "7" } as parentMeContract.ChildResponse,
  ];
  beforeEach(() => {
    family.children.mockResolvedValue(linked);
  });
  it.each(["features", "today"] as const)(
    "keeps the latest successful %s value per child",
    async (kind) => {
      const request = kind === "features" ? family.features : family.today;
      const initial =
        kind === "features" ? features : { at_ogs: true, state: "present" };
      const fresh =
        kind === "features"
          ? { ...features, sick_note_enabled: false }
          : { at_ogs: false, state: "left" };
      const failure = new ApiError("offline", 503, {
        code: "general.unavailable",
      });
      request.mockResolvedValue(
        initial as parentMeContract.ChildFeaturesResponse &
          parentMeContract.TodayStatusResponse,
      );
      const { result } = renderHook(
        () => ({
          features: useParentFeatures(linked),
          today: useParentToday(linked),
        }),
        { wrapper: ParentResourceTestProvider },
      );
      await waitFor(() =>
        expect(result.current[kind].data?.["42"]).toEqual(initial),
      );
      request.mockImplementation(async (id) => {
        if (id === "43") throw failure;
        return fresh as parentMeContract.ChildFeaturesResponse &
          parentMeContract.TodayStatusResponse;
      });
      await act(async () => {
        await result.current[kind].mutate();
      });
      expect(result.current[kind].data?.["42"]).toEqual(fresh);
      request.mockImplementation(async (id) => {
        if (id === "42") throw failure;
        return fresh as parentMeContract.ChildFeaturesResponse &
          parentMeContract.TodayStatusResponse;
      });
      await act(async () => {
        await result.current[kind].mutate();
      });
      expect(result.current[kind].error).toMatchObject({ code: failure.code });
      expect(result.current[kind].data).toEqual({ "42": fresh, "43": fresh });
    },
  );
});
