import { parentFamilyFixture } from "~/test/parent-family-fixture";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import deMessages from "~/i18n/messages/de.generated";
import * as parentApi from "~/lib/parent-api";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";
import { useChildCare } from "./child-care";
import { useChildMasterData } from "./child-master-data";
import { BookedCareSection } from "./child/booked-care-section";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

const family = parentFamilyFixture();

vi.unmock("swr");
vi.mock("~/lib/parent-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/parent-api")>()),
}));

const features = {
  sick_note_enabled: true,
} as unknown as parentMeContract.ChildFeaturesResponse;
const schedule = {
  weekdays: [],
  today_absent: false,
} as unknown as parentMeContract.CareScheduleResponse;
const child = {
  student_id: "42",
  tenant_id: "1",
} as parentMeContract.ChildResponse;

function withProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={deMessages}>
      <ParentResourceTestProvider>{children}</ParentResourceTestProvider>
    </NextIntlClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.restoreAllMocks();

  family.mockRead();
  family.children.mockResolvedValue([child]);
});

// The child page's sections share one cached read per child and endpoint
// (#4994).
describe("shared child requests (#4994)", () => {
  it("liefert beiden Betreuungsabschnitten nach einer Änderung frische Daten", async () => {
    const oldSchedule = deferred<parentMeContract.CareScheduleResponse>();
    const previousSchedule = {
      ...schedule,
      can_request: false,
      request_capabilities: {
        arrival: false,
        pickup: false,
        departure_mode: false,
      },
    };
    const freshSchedule = {
      ...previousSchedule,
      today_absent: true,
      weekdays: [
        { weekday: 1, status: "scheduled", pickup: "16:30", modes: ["pickup"] },
      ],
    } as parentMeContract.CareScheduleResponse;
    const getSchedule = vi
      .spyOn(parentApi, "getChildCareSchedule")
      .mockReturnValueOnce(oldSchedule.promise)
      .mockResolvedValue(freshSchedule);
    family.features.mockResolvedValue(features);
    vi.spyOn(parentApi, "getChildCareOfferings").mockResolvedValue({
      offerings: [],
      can_request: false,
    } as unknown as Awaited<
      ReturnType<typeof parentApi.getChildCareOfferings>
    >);
    vi.spyOn(parentApi, "listSickDays").mockResolvedValue([]);
    vi.spyOn(parentApi, "listExcusedRequests").mockResolvedValue([]);
    vi.spyOn(parentApi, "listCareExceptions").mockResolvedValue([]);
    vi.spyOn(parentApi, "listPickupChangeRequests").mockResolvedValue([]);

    const { result } = renderHook(() => useChildCare("42"), {
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="de" messages={deMessages}>
          <ParentResourceTestProvider>
            {children}
            <BookedCareSection
              studentId="42"
              childFirstName="Mia"
              careEnded={false}
            />
          </ParentResourceTestProvider>
        </NextIntlClientProvider>
      ),
    });
    expect(getSchedule).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("parent-conversation-refresh", {
          detail: { studentId: "42" },
        }),
      );
    });
    await act(async () => {
      oldSchedule.resolve(previousSchedule);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.todayPickup).toEqual({ kind: "absent" });
      expect(screen.getByText("16:30 Uhr")).toBeInTheDocument();
    });
    expect(getSchedule).toHaveBeenCalledTimes(2);
  });

  // Betreuung und Angaben brauchen beide die Schulschalter; auf einer
  // Kindseite holt sie nur ein Abruf.
  it("laedt die Schulschalter fuer Betreuung und Angaben einmal", async () => {
    const getFeatures = family.features.mockResolvedValue(features);
    const getSchedule = vi
      .spyOn(parentApi, "getChildCareSchedule")
      .mockResolvedValue(schedule);
    vi.spyOn(parentApi, "getChildMasterData").mockResolvedValue(
      {} as Awaited<ReturnType<typeof parentApi.getChildMasterData>>,
    );
    vi.spyOn(parentApi, "listSickDays").mockResolvedValue([]);
    vi.spyOn(parentApi, "listExcusedRequests").mockResolvedValue([]);
    vi.spyOn(parentApi, "listCareExceptions").mockResolvedValue([]);
    vi.spyOn(parentApi, "listPickupChangeRequests").mockResolvedValue([]);

    const { result } = renderHook(
      () => ({
        care: useChildCare("42"),
        masterData: useChildMasterData("42"),
      }),
      { wrapper: withProvider },
    );

    await waitFor(() => {
      expect(result.current.care.loading).toBe(false);
      expect(result.current.masterData.loading).toBe(false);
    });
    expect(result.current.masterData.features).toBe(features);
    expect(result.current.care.features).toBe(features);
    expect(getFeatures).toHaveBeenCalledTimes(1);
    expect(getSchedule).toHaveBeenCalledTimes(1);
  });
});
