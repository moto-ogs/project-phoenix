import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseFakeTimers } from "~/test/clock";
import {
  expectIdleRenderBudget,
  RENDER_BUDGET_MAX_COMMITS,
} from "~/test/render-budget";
import { TenantPage } from "~/components/ui/tenant-page";
import { RouteTitle } from "./route-title";

const navigation = vi.hoisted(() => ({ pathname: "/students/42" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = { pages: {} };

const TABS = [
  { value: "overview", label: "Überblick" },
  { value: "history", label: "Verlauf" },
];

function renderRecord(tabs: { value: string; inUrl?: boolean }) {
  return render(
    <RouteTitle hostSurface="ogs" messages={MESSAGES}>
      <TenantPage
        title="Kindakte"
        tabs={{ ...tabs, onChange: () => undefined, items: TABS }}
      />
    </RouteTitle>,
  );
}

describe("RouteTitle", () => {
  beforeEach(() => {
    navigation.pathname = "/students/42";
  });

  it("names the page by its route, not by the record", async () => {
    render(
      <RouteTitle hostSurface="ogs" messages={MESSAGES}>
        <div />
      </RouteTitle>,
    );

    await waitFor(() => expect(document.title).toBe("Kindakte – moto"));
  });

  it("puts a tab the address selects in front of the title", async () => {
    renderRecord({ value: "history", inUrl: true });

    await waitFor(() =>
      expect(document.title).toBe("Kindakte: Verlauf – moto"),
    );
  });

  it("keeps a tab outside the address out of the title", async () => {
    renderRecord({ value: "history" });

    await waitFor(() => expect(document.title).toBe("Kindakte – moto"));
  });

  it("drops the tab when its page unmounts", async () => {
    const view = renderRecord({ value: "history", inUrl: true });
    await waitFor(() =>
      expect(document.title).toBe("Kindakte: Verlauf – moto"),
    );

    view.rerender(
      <RouteTitle hostSurface="ogs" messages={MESSAGES}>
        <div />
      </RouteTitle>,
    );

    await waitFor(() => expect(document.title).toBe("Kindakte – moto"));
  });

  // Render-Budget (#2939): RouteTitle wraps every page from the root layout,
  // and a page reports its tab from an effect; that must not loop.
  describe("render budget", () => {
    afterEach(() => {
      releaseFakeTimers();
    });

    it(`commits at most ${RENDER_BUDGET_MAX_COMMITS} times in idle with a reported tab`, async () => {
      vi.useFakeTimers();

      await expectIdleRenderBudget(
        <RouteTitle hostSurface="ogs" messages={MESSAGES}>
          <TenantPage
            title="Kindakte"
            tabs={{
              value: "history",
              inUrl: true,
              onChange: () => undefined,
              items: TABS,
            }}
          />
        </RouteTitle>,
      );
    });
  });
});
