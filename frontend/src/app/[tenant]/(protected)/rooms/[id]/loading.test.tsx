import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RoomDetailLoading from "./loading";

const presenceModeState = vi.hoisted(() => ({ mode: "detailed" }));

vi.mock("~/lib/tenant-context", () => ({
  usePresenceMode: () => presenceModeState.mode,
}));

vi.mock("./page-skeleton", () => ({
  RoomDetailLoadingPage: ({ info }: { info?: string }) => (
    <div data-testid="room-loading" data-info={info} />
  ),
}));

describe("RoomDetailLoading", () => {
  beforeEach(() => {
    presenceModeState.mode = "detailed";
  });

  it("explains room occupancy while the route loads", () => {
    render(<RoomDetailLoading />);

    expect(screen.getByTestId("room-loading")).toHaveAttribute(
      "data-info",
      "Hier siehst du, ob dieser Raum belegt ist. Unter „Kinder im Raum“ stehen die Kinder, die gerade dort sind. Wähle ein Kind, um seine Angaben zu öffnen.",
    );
  });

  it("explains the room record in binary presence mode", () => {
    presenceModeState.mode = "binary";
    render(<RoomDetailLoading />);

    expect(screen.getByTestId("room-loading")).toHaveAttribute(
      "data-info",
      "Hier stehen die Angaben zu diesem Raum. Deine Schule erfasst nicht, welche Kinder in welchem Raum sind.",
    );
  });
});
