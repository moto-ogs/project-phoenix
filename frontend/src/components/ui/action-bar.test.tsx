import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActionBar } from "./action-bar";

describe("ActionBar", () => {
  it("renders nothing on the desktop, where the page keeps its own action", () => {
    render(
      <>
        <p>Seiteninhalt</p>
        <ActionBar status="3 Kinder gewählt">
          <button type="button">Speichern</button>
        </ActionBar>
      </>,
    );
    expect(screen.getByText("Seiteninhalt")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
  });
});
