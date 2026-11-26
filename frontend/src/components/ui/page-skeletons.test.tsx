import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobilePageHelpTargetContext } from "./mobile-page-help-target";
import {
  ChoiceTileListSkeleton,
  HistorySkeleton,
  SkeletonRegion,
  TenantPageHeaderSkeleton,
} from "./page-skeletons";

describe("SkeletonRegion", () => {
  it("shows its loading shape immediately without an invisible transition", () => {
    render(
      <SkeletonRegion label="Daten werden geladen">
        <div data-testid="shape" />
      </SkeletonRegion>,
    );

    expect(screen.getByTestId("shape").parentElement).not.toHaveClass(
      "moto-skeleton-defer",
    );
    expect(
      screen.getByRole("status", { name: "Daten werden geladen" }),
    ).toHaveAttribute("aria-busy", "true");
  });
});

// Steht die Portalhülle, meldet sich der Platz für die Seitenhilfe hier an.
const helpRegistration = {
  registerTarget: vi.fn(),
  unregisterTarget: vi.fn(),
};

describe("TenantPageHeaderSkeleton", () => {
  it("drops the status line row for a page without stats", () => {
    const { container: withStats } = render(<TenantPageHeaderSkeleton />);
    const { container: withoutStats } = render(
      <TenantPageHeaderSkeleton stats={false} />,
    );

    expect(withStats.querySelectorAll(".animate-pulse")).toHaveLength(2);
    expect(withoutStats.querySelectorAll(".animate-pulse")).toHaveLength(1);
  });

  it("reserves the info button next to the title when requested", () => {
    const { container } = render(
      <TenantPageHeaderSkeleton stats={false} info />,
    );

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2);
    expect(container.querySelector(".h-8.w-8")).toBeInTheDocument();
  });

  // Unter `lg` steht die Hilfe als Knopf im Kopf von `TenantPage` und von
  // `ParentPageHeader`. Ohne denselben Platz im Ladekopf wächst der Kopf beim
  // Laden um diesen Knopf (#6568, im Elternportal #6613).
  it.each(["tenant-page", "parent-page"] as const)(
    "offers the page help its place in the head (%s)",
    (matches) => {
      const { registerTarget } = helpRegistration;
      registerTarget.mockClear();
      render(
        <MobilePageHelpTargetContext.Provider value={helpRegistration}>
          <TenantPageHeaderSkeleton matches={matches} stats={false} />
        </MobilePageHelpTargetContext.Provider>,
      );
      expect(registerTarget).toHaveBeenCalledOnce();
      expect(screen.getByRole("banner")).toContainElement(
        registerTarget.mock.calls[0]?.[0] as HTMLElement,
      );
    },
  );

  // Der Elternkopf hat keine Statuszeile; sein Ladekopf zeigt nur den Titel.
  it("never shows a status line for the parents portal head", () => {
    const { container } = render(
      <TenantPageHeaderSkeleton matches="parent-page" stats />,
    );

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
  });
});

describe("HistorySkeleton", () => {
  it("mirrors a grouped history with separate detail cards", () => {
    const { container } = render(<HistorySkeleton />);

    expect(
      container.querySelectorAll(".moto-content-surface.rounded-xl"),
    ).toHaveLength(2);
    expect(container.querySelectorAll(".border-t")).toHaveLength(2);
  });
});

describe("ChoiceTileListSkeleton", () => {
  it("mirrors separate choice rows with an action slot", () => {
    const { container } = render(<ChoiceTileListSkeleton rows={2} avatar />);

    expect(container.querySelectorAll(".rounded-xl.border")).toHaveLength(2);
    expect(container.querySelectorAll(".h-8.w-16")).toHaveLength(2);
    expect(container.querySelectorAll(".h-8.w-8.rounded-full")).toHaveLength(2);
    expect(container.querySelector(".divide-y")).not.toBeInTheDocument();
  });
});
