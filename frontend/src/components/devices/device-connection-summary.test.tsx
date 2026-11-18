import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeviceConnectionSummary } from "./device-connection-summary";
import { TEST_CLOCK_INSTANT } from "~/test/clock-instant";

// Two days and an hour before the frozen test clock, wherever CI moves it.
const seen = new Date(
  TEST_CLOCK_INSTANT.getTime() - (2 * 24 + 1) * 60 * 60 * 1000,
).toISOString();

describe("DeviceConnectionSummary", () => {
  it("shows a device online with its last contact", () => {
    render(<DeviceConnectionSummary isOnline lastSeen={seen} />);
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(
      screen.getByText(/^Letzter Kontakt vor 2 Tagen · /),
    ).toBeInTheDocument();
  });

  it("shows a device offline with its last contact", () => {
    render(<DeviceConnectionSummary isOnline={false} lastSeen={seen} />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(
      screen.getByText(/^Letzter Kontakt vor 2 Tagen · /),
    ).toBeInTheDocument();
  });

  it("says when a device never reported", () => {
    render(<DeviceConnectionSummary isOnline={false} />);
    expect(screen.getByText("Noch nie verbunden")).toBeInTheDocument();
    expect(
      screen.getByText("Das Gerät hat sich noch nie bei moto gemeldet."),
    ).toBeInTheDocument();
  });

  it("does not call a blocked device online, whatever its last contact", () => {
    render(<DeviceConnectionSummary isOnline lastSeen={seen} blocked />);
    expect(screen.getByText("Keine Verbindung möglich")).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
  });
});
