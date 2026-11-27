import { render, screen } from "@testing-library/react";
import { BELOW_MD } from "~/lib/hooks/use-media-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseCreateAction } from "./database-create-action";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("DatabaseCreateAction", () => {
  beforeEach(() => {
    stubMatchMedia(true);
    document.documentElement.style.removeProperty("--moto-floating-fab-offset");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--moto-floating-fab-offset");
  });

  it("publishes stack clearance while its mobile FAB is visible", () => {
    const { container, unmount } = render(
      <div data-testid="header-action-slot">
        <DatabaseCreateAction
          label="Raum"
          ariaLabel="Raum erstellen"
          onClick={() => undefined}
        />
      </div>,
    );

    expect(
      screen.getAllByRole("button", { name: "Raum erstellen" }),
    ).toHaveLength(2);
    expect(window.matchMedia).toHaveBeenCalledWith(BELOW_MD);
    expect(
      document.documentElement.style.getPropertyValue(
        "--moto-floating-fab-offset",
      ),
    ).toBe("4.5rem");

    // The TenantPage header is its own stacking context. The FAB must be
    // portaled outside its action slot so it floats above the content.
    expect(container.querySelector("[data-icon-only]")).not.toBeInTheDocument();
    expect(document.body.querySelector("[data-icon-only]")).toHaveClass(
      "fixed",
      "right-4",
      "bottom-24",
    );

    unmount();
    expect(
      document.documentElement.style.getPropertyValue(
        "--moto-floating-fab-offset",
      ),
    ).toBe("");
  });

  it("does not reserve FAB clearance at desktop widths", () => {
    stubMatchMedia(false);
    render(
      <DatabaseCreateAction
        label="Raum"
        ariaLabel="Raum erstellen"
        onClick={() => undefined}
      />,
    );

    const [desktop, mobile] = screen.getAllByRole("button", {
      name: "Raum erstellen",
    });
    expect(desktop).toHaveClass("md:flex");
    expect(mobile).toHaveClass("md:hidden");
    expect(
      document.documentElement.style.getPropertyValue(
        "--moto-floating-fab-offset",
      ),
    ).toBe("");
  });
});
