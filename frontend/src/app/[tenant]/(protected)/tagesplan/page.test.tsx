import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePresenceMode } from "~/lib/tenant-context";
import TagesplanPage from "./page";

describe("TagesplanPage", () => {
  it("shows binary-mode-specific page information", () => {
    vi.mocked(usePresenceMode).mockReturnValueOnce("binary");

    render(<TagesplanPage />);

    fireEvent.click(screen.getByRole("button", { name: "Erklärung zu Heute" }));
    expect(
      screen.getByText(
        "Hier wäre der Betreuungsplan deiner Schule. Deine Schule nutzt ihn zurzeit nicht.",
      ),
    ).toBeInTheDocument();
  });
});
