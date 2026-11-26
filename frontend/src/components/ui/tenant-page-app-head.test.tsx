import { render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { AppTenantHead } from "./tenant-page-app-head";

vi.mock("./mobile-page-help-target", () => ({
  MobilePageHelpTarget: () => null,
}));

const lupe = (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    aria-label="Nachrichten suchen"
    tooltip="Zeigt das Suchfeld."
    data-icon-only=""
  >
    L
  </Button>
);

function compactHead(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>(
    "[data-app-page-head-compact]",
  );
  if (node === null) throw new Error("schmaler Kopf fehlt");
  return node;
}

describe("AppTenantHead: schmaler Kopf", () => {
  it("zeigt ohne `compactActions` keine Symbol-Aktionen", () => {
    const { container } = render(
      <AppTenantHead
        title="Nachrichten"
        headRef={createRef<HTMLElement>()}
        actions={lupe}
      />,
    );
    const compact = compactHead(container);
    expect(within(compact).getByText("Nachrichten")).toBeInTheDocument();
    expect(compact.querySelector("[data-app-head-compact-actions]")).toBeNull();
  });

  it("behält mit `compactActions` die Symbol-Aktionen der Kopfkarte", () => {
    const { container } = render(
      <AppTenantHead
        title="Nachrichten"
        headRef={createRef<HTMLElement>()}
        actions={lupe}
        compactActions
      />,
    );
    const slot = compactHead(container).querySelector<HTMLElement>(
      "[data-app-head-compact-actions]",
    );
    expect(slot).not.toBeNull();
    expect(
      within(slot!).getByRole("button", {
        name: "Nachrichten suchen",
        hidden: true,
      }),
    ).toBeInTheDocument();
  });

  it("zeigt ein eigenes Element und den Kurzstatus nebeneinander", () => {
    const { container } = render(
      <AppTenantHead
        title="Heute"
        headRef={createRef<HTMLElement>()}
        compactStats={<span>Mi, 26.11.</span>}
        compactActions={lupe}
      />,
    );
    const compact = compactHead(container);
    expect(within(compact).getByText("Mi, 26.11.")).toBeInTheDocument();
    expect(
      within(compact).getByRole("button", {
        name: "Nachrichten suchen",
        hidden: true,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Heute").length).toBeGreaterThan(0);
  });
});
