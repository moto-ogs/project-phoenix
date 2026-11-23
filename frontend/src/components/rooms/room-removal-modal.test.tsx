import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "~/lib/swr/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchRoomRemovalImpact: vi.fn(),
  removeRoom: vi.fn(),
}));

vi.mock("~/lib/room-removal-api", () => ({
  fetchRoomRemovalImpact: mocks.fetchRoomRemovalImpact,
  removeRoom: mocks.removeRoom,
}));

import { ApiError } from "~/lib/api-error";
import { RoomRemovalModal } from "./room-removal-modal";
import type { RoomRemovalImpact } from "~/lib/room-removal-api";

vi.unmock("swr");

function SWRTestWrapper({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}

function render(
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) {
  return rtlRender(ui, { wrapper: SWRTestWrapper, ...options });
}

const unused: RoomRemovalImpact = {
  outcome: "delete",
  active_session: false,
  care_offering: false,
  references: {
    activity_groups: 0,
    upcoming_blocks: 0,
    education_groups: 0,
    devices: 0,
    past_blocks: 0,
    archived_activity_groups: 0,
    has_session_history: false,
  },
  fingerprint: "vorschau-1",
};

function renderModal(onRemoved = vi.fn()) {
  render(
    <RoomRemovalModal
      isOpen
      roomId="7"
      roomName="Igelraum"
      onClose={vi.fn()}
      onRemoved={onRemoved}
    />,
  );
  return onRemoved;
}

describe("RoomRemovalModal (#6845)", () => {
  beforeEach(() => {
    mocks.fetchRoomRemovalImpact.mockReset();
    mocks.removeRoom.mockReset();
  });

  it("names what still uses the room and keeps it", async () => {
    mocks.fetchRoomRemovalImpact.mockResolvedValue({
      ...unused,
      outcome: "blocked",
      references: { ...unused.references, devices: 1, upcoming_blocks: 3 },
    });
    renderModal();

    expect(
      await screen.findByRole("heading", { name: "Raum wird noch genutzt" }),
    ).toBeVisible();
    expect(screen.getByText("Gerät steht hier")).toBeVisible();
    expect(screen.getByText("Kommende Termine")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByRole("button", { name: /löschen/i })).toBeDisabled();
    expect(mocks.removeRoom).not.toHaveBeenCalled();
  });

  it("archives a room that history still names", async () => {
    mocks.fetchRoomRemovalImpact.mockResolvedValue({
      ...unused,
      outcome: "archive",
      references: {
        ...unused.references,
        past_blocks: 12,
        has_session_history: true,
      },
    });
    mocks.removeRoom.mockResolvedValue("archive");
    const onRemoved = renderModal();

    expect(
      await screen.findByRole("heading", { name: "Raum archivieren?" }),
    ).toBeVisible();
    expect(screen.getByText("Bleibt im Verlauf erhalten")).toBeVisible();
    expect(screen.getByText("Vergangene Termine")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Ja, archivieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("archive"));
    expect(mocks.removeRoom).toHaveBeenCalledWith("7", "vorschau-1");
  });

  it("deletes a room nothing uses", async () => {
    mocks.fetchRoomRemovalImpact.mockResolvedValue(unused);
    renderModal();

    expect(await screen.findByText(/wird nirgends genutzt/)).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Raum löschen?" }),
    ).toBeVisible();
  });

  it("shows the stored preview when the room changed since it was read", async () => {
    mocks.fetchRoomRemovalImpact
      .mockResolvedValueOnce(unused)
      .mockResolvedValue({
        ...unused,
        outcome: "archive",
        references: { ...unused.references, past_blocks: 2 },
        fingerprint: "vorschau-2",
      });
    mocks.removeRoom.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const onRemoved = renderModal();
    expect(
      await screen.findByRole("heading", { name: "Raum löschen?" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Ja, l/ }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    expect(
      await screen.findByRole("heading", { name: "Raum archivieren?" }),
    ).toBeVisible();
    expect(mocks.removeRoom).toHaveBeenCalledWith("7", "vorschau-1");
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Erneut versuchen" }),
    ).not.toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
