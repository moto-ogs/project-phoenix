import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionBar } from "./action-bar";
import { SplitView } from "./split-view";

vi.mock("next/navigation", () => ({
  usePathname: () => "/students/search",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** iPad quer: App-Oberfläche, Finger, mindestens 64 rem breit. */
function emulateSplit() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query !== "(width < 40rem)",
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SplitView", () => {
  it("shows only the list outside the split layout (phone, iPad portrait, desktop)", () => {
    render(
      <SplitView
        list={<p>Liste</p>}
        detail={<p>Detail</p>}
        empty="Wähle links ein Kind."
      />,
    );
    expect(screen.getByText("Liste")).toBeInTheDocument();
    expect(screen.queryByText("Detail")).not.toBeInTheDocument();
  });

  it("on iPad landscape keeps the page still and lets each column scroll on its own", () => {
    emulateSplit();
    const { unmount } = render(
      <SplitView
        list={<p>Liste</p>}
        detail={<p>Detail</p>}
        empty="Wähle links ein Kind."
      />,
    );
    const list = screen.getByText("Liste").closest("[data-split-list]");
    const detail = screen.getByText("Detail").closest("[data-split-detail]");
    expect(list).toHaveClass("overflow-y-auto");
    expect(detail).toHaveClass("overflow-y-auto");
    expect(document.documentElement).toHaveAttribute("data-split-page");
    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-split-page");
  });

  it("places the ActionBar in the column its task belongs to", () => {
    emulateSplit();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const left = this.hasAttribute("data-split-detail") ? 400 : 16;
        return { left, width: 360, top: 0, height: 0 } as DOMRect;
      },
    );
    render(
      <>
        <SplitView list={<p>Liste</p>} detail={<p>Detail</p>} empty="" />
        <ActionBar column="detail">
          <button type="button">Abmelden</button>
        </ActionBar>
      </>,
    );
    const bar = screen
      .getByRole("button", { name: "Abmelden" })
      .closest("[data-action-bar]");
    expect(bar).toHaveStyle({ left: "400px", width: "360px" });
    expect(document.documentElement).toHaveAttribute(
      "data-action-bar-column",
      "detail",
    );
  });
});
