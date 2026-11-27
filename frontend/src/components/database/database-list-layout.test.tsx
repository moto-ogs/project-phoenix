import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_WIDTH,
  PHONE_WIDTH,
  setViewportWidth,
} from "~/test/helpers/viewport";
import { DatabaseListLayout } from "./database-list-layout";

describe("DatabaseListLayout", () => {
  afterEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
  });

  it("renders the list inside one full-width card", () => {
    render(
      <DatabaseListLayout>
        <ul>
          <li>Mia Fischer</li>
        </ul>
      </DatabaseListLayout>,
    );

    const root = screen.getByTestId("database-list-layout");
    expect(root.style.height).toContain("100dvh");
    expect(screen.getByText("Mia Fischer")).toBeInTheDocument();
    expect(root.querySelector(".moto-content-surface")).not.toBeNull();
  });

  // #3330: Am Computer setzt useFillHeight die Höhe und die Liste scrollt in
  // der Karte. Den Browser-Nachbau prüft e2e/layout/database-layouts.spec.ts.
  it("takes the card out of the grow rule on a computer", () => {
    render(
      <DatabaseListLayout>
        <div>Inhalt</div>
      </DatabaseListLayout>,
    );

    const card = screen
      .getByTestId("database-list-layout")
      .querySelector(":scope > .moto-content-surface");
    expect(card).toHaveClass("moto-scroll-surface", "min-h-0", "flex-1");
  });

  it("lets the page scroll on a phone instead of fixing the card's height", () => {
    setViewportWidth(PHONE_WIDTH);

    render(
      <DatabaseListLayout>
        <div>Inhalt</div>
      </DatabaseListLayout>,
    );

    const root = screen.getByTestId("database-list-layout");
    expect(root.style.height).toBe("");
    const card = root.querySelector(":scope > .moto-content-surface");
    expect(card).not.toBeNull();
    expect(card).not.toHaveClass("moto-scroll-surface");
  });
});
