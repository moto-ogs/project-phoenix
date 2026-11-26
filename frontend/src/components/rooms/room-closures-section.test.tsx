import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import type { RoomClosure } from "~/lib/room-closures-api";
import { testClockDay } from "~/test/clock";
import { RoomClosuresSection } from "./room-closures-section";

const { swrState, reopenMock, invalidateMock } = vi.hoisted(() => ({
  swrState: {
    data: undefined as RoomClosure[] | undefined,
    key: undefined as string | null | undefined,
  },
  reopenMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: (key: string | null) => {
    swrState.key = key;
    return {
      data: swrState.data,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    };
  },
  useInvalidateFamily: () => invalidateMock,
}));

vi.mock("~/lib/room-closures-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/room-closures-api")>()),
  reopenRoom: reopenMock,
}));

// Der Dialog „Raum sperren“ ist hier nicht Gegenstand.
vi.mock("./room-closure-modal", () => ({ RoomClosureModal: () => null }));

function renderSection(canUpdate = true) {
  render(
    <ToastProvider>
      <RoomClosuresSection
        roomId="10"
        canUpdate={canUpdate}
        canReadPlan
        planHref={(day) => `/rooms/10?tab=plan&d=${day}`}
      />
    </ToastProvider>,
  );
}

describe("RoomClosuresSection (#7653)", () => {
  beforeEach(() => {
    reopenMock.mockReset().mockResolvedValue(undefined);
    invalidateMock.mockReset();
    swrState.key = undefined;
  });

  it("says the room is open while it has no closure", () => {
    swrState.data = [];
    renderSection();

    expect(
      screen.getByText("Der Raum ist nicht gesperrt."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Raum sperren" }),
    ).toBeInTheDocument();
  });

  it("loads through the last day a new closure may start", () => {
    swrState.data = [];
    renderSection();

    expect(swrState.key).toBe(
      `room-closures-${testClockDay(0)}-${testClockDay(365)}-10`,
    );
  });

  it("lists each closure with reason and period and marks today's", () => {
    swrState.data = [
      {
        id: "1",
        roomId: "10",
        startDate: testClockDay(0),
        endDate: testClockDay(1),
        reason: "Wasserschaden",
      },
      {
        id: "2",
        roomId: "10",
        startDate: testClockDay(5),
        endDate: testClockDay(5),
        reason: "Reinigung",
      },
    ];
    renderSection();

    expect(screen.getByText("Wasserschaden")).toBeInTheDocument();
    expect(screen.getByText("Reinigung")).toBeInTheDocument();
    expect(screen.getAllByText("Heute gesperrt")).toHaveLength(1);
  });

  it("shows closures without write actions to room readers", () => {
    swrState.data = [
      {
        id: "1",
        roomId: "10",
        startDate: testClockDay(0),
        endDate: testClockDay(1),
        reason: "Wasserschaden",
      },
    ];
    renderSection(false);

    expect(screen.getByText("Wasserschaden")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Raum sperren" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Aktionen zur Sperre Wasserschaden",
      }),
    ).not.toBeInTheDocument();
  });

  it("lifts a closure after the question and refreshes the closures", async () => {
    swrState.data = [
      {
        id: "7",
        roomId: "10",
        startDate: testClockDay(2),
        endDate: testClockDay(3),
        reason: "Umbau",
      },
    ];
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: "Aktionen zur Sperre Umbau" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Sperre aufheben/ }),
    );
    expect(reopenMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Aufheben" }));

    await waitFor(() => expect(reopenMock).toHaveBeenCalledWith("10", "7"));
    expect(invalidateMock).toHaveBeenCalledWith("room-closures-");
  });
});
