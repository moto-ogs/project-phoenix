import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useCheckinTarget } from "~/lib/hooks/use-checkin-target";
import { SWRConfig } from "~/lib/swr/testing";
import { SchoolCheckinTargetPicker } from "./school-checkin-target-picker";

// A remembered target that is gone is a state in the content (#7704): the
// notice has no X and ends once a new target is chosen.

vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "7", tenantId: 1, isAdmin: true },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  usePresenceMode: () => "detailed",
  useAttendanceWebEnabled: () => true,
  useTenantSlugSafe: () => "schule-a",
}));
vi.mock("~/lib/active-service", () => ({
  activeService: {
    getActiveGroups: vi.fn(async () => [
      {
        id: "12",
        groupId: null,
        roomId: "3",
        startTime: new Date(0),
        isActive: true,
        supervisorCount: 1,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ]),
    getStaffActiveSupervisions: vi.fn(async () => []),
  },
}));
vi.mock("~/lib/activity-api", () => ({
  fetchActivities: vi.fn(async () => []),
}));
vi.mock("~/lib/swr/rooms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/swr/rooms")>();
  return {
    ...actual,
    rooms: {
      ...actual.rooms,
      fetcher: vi.fn(async () => [
        { id: "3", name: "Mensa", isOccupied: true },
      ]),
    },
  };
});

const STORAGE_KEY = "moto:checkin-target:schule-a:7";

function Picker() {
  return <SchoolCheckinTargetPicker state={useCheckinTarget(true)} />;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      value: "99",
      kind: "session",
      roomId: "5",
      roomName: "Werkraum",
    }),
  );
});

it("keeps the notice on a lost target without an X until a new target is chosen", async () => {
  render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        shouldRetryOnError: false,
      }}
    >
      <Picker />
    </SWRConfig>,
  );

  const notice = /In Werkraum läuft keine Aufsicht mehr/;
  expect(await screen.findByText(notice)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /schließen/i }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("combobox", { name: "Anmelden in" }));
  fireEvent.click(await screen.findByRole("option", { name: /Mensa/ }));

  await waitFor(() =>
    expect(screen.queryByText(notice)).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("combobox", { name: "Anmelden in" }),
  ).toHaveTextContent("Mensa");
});
