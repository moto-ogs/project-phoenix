import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeviceSlotStatus } from "./device-slot-status";

describe("DeviceSlotStatus", () => {
  it("names occupied, booked and free places with a meter", () => {
    render(<DeviceSlotStatus slots={{ booked: 5, occupied: 4, free: 1 }} />);

    const line = screen.getByTestId("device-slot-status");
    expect(line).toHaveTextContent("Geräteplätze: 4 von 5 belegt");
    expect(line).toHaveTextContent("1 frei");
    expect(
      screen.getByRole("progressbar", {
        hidden: true,
        name: "4 von 5 Geräteplätzen belegt",
      }),
    ).toHaveAttribute("aria-valuenow", "4");
  });

  it("says full and points to moto when every place is taken", () => {
    render(<DeviceSlotStatus slots={{ booked: 3, occupied: 3, free: 0 }} />);

    const line = screen.getByTestId("device-slot-status");
    expect(line).toHaveTextContent("3 von 3 belegt");
    expect(screen.getByText("voll")).toBeInTheDocument();
    expect(line).toHaveTextContent("melde dich beim moto-Team");
    expect(screen.queryByText(/^\d+ frei$/)).not.toBeInTheDocument();
  });

  it("shows nothing without a limit", () => {
    const { container } = render(
      <DeviceSlotStatus slots={{ booked: null, occupied: 3, free: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
