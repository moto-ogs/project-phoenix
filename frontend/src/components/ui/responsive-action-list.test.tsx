import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "./responsive-action-list";

describe("ResponsiveActionRow", () => {
  it("renders each row as an item of the list", () => {
    render(
      <ResponsiveActionList id="hinweise">
        <ResponsiveActionRow>
          <span>„Fußball-AG“</span>
          <button type="button">Anlegen</button>
        </ResponsiveActionRow>
        <ResponsiveActionRow>
          <span>„Kunst“</span>
        </ResponsiveActionRow>
      </ResponsiveActionList>,
    );

    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("id", "hinweise");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0]!).getByRole("button", { name: "Anlegen" }),
    ).toBeInTheDocument();
  });

  it("joins the shared action column of the list from sm on", () => {
    render(
      <ResponsiveActionList>
        <ResponsiveActionRow>Zeile</ResponsiveActionRow>
      </ResponsiveActionList>,
    );

    expect(screen.getByRole("listitem")).toHaveClass(
      "sm:col-span-2",
      "sm:grid",
      "sm:grid-cols-subgrid",
    );
  });

  it("aligns the row to the top when asked", () => {
    render(
      <ResponsiveActionList>
        <ResponsiveActionRow align="start">Zeile</ResponsiveActionRow>
      </ResponsiveActionList>,
    );

    const row = screen.getByRole("listitem");
    expect(row).toHaveClass("sm:items-start");
    expect(row).not.toHaveClass("sm:items-center");
  });
});

describe("ResponsiveRowActions", () => {
  function renderActions(node: ReactNode) {
    render(
      <ResponsiveActionList>
        <ResponsiveActionRow>
          <span>Zeile</span>
          {node}
        </ResponsiveActionRow>
      </ResponsiveActionList>,
    );
    return screen.getByTestId("actions");
  }

  it("stacks the actions full width on a phone, side by side from 480 px, right from sm", () => {
    const actions = renderActions(
      <ResponsiveRowActions data-testid="actions">
        <button type="button">Ansehen</button>
        <button type="button">Anlegen</button>
      </ResponsiveRowActions>,
    );

    expect(actions).toHaveClass(
      "flex",
      "flex-col",
      "min-[480px]:flex-row",
      "sm:justify-end",
    );
    expect(within(actions).getAllByRole("button")).toHaveLength(2);
  });

  it("starts the actions under the text beside a leading icon or avatar", () => {
    const actions = renderActions(
      <ResponsiveRowActions data-testid="actions" leading={32}>
        <button type="button">Akte anlegen</button>
      </ResponsiveRowActions>,
    );

    expect(actions).toHaveClass("max-sm:pl-11");
  });

  it("keeps a menu at the end of the row, beside the buttons", () => {
    const actions = renderActions(
      <ResponsiveRowActions
        data-testid="actions"
        menu={<button type="button">Weitere Aktionen</button>}
      >
        <button type="button">Erneuern</button>
      </ResponsiveRowActions>,
    );

    const [main, menu] = within(actions).getAllByRole("button");
    expect(main).toHaveTextContent("Erneuern");
    expect(menu).toHaveTextContent("Weitere Aktionen");
    expect(actions).toHaveClass("flex", "items-center");
    expect(actions).not.toHaveClass("flex-col");
  });

  it("puts a lone menu at the end of the row also on a phone", () => {
    const actions = renderActions(
      <ResponsiveRowActions
        data-testid="actions"
        menu={<button type="button">Aktionen</button>}
      />,
    );

    expect(actions).toHaveClass("justify-end");
  });

  it("gives a single field the row width on a phone and a fixed width from sm", () => {
    const actions = renderActions(
      <ResponsiveRowActions data-testid="actions" field>
        <input aria-label="Art" />
      </ResponsiveRowActions>,
    );

    expect(actions).toHaveClass("w-full", "sm:w-72");
  });
});
