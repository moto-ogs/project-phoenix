import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantPage } from "~/components/ui/tenant-page";
import { RouteTitle } from "./route-title";

const navigation = vi.hoisted(() => ({ pathname: "/students/42" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = { portals: {}, pages: {} };

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

    await waitFor(() => expect(document.title).toBe("Kindakte – OGS – moto"));
  });

  it("puts a tab the address selects in front of the title", async () => {
    renderRecord({ value: "history", inUrl: true });

    await waitFor(() =>
      expect(document.title).toBe("Verlauf – Kindakte – OGS – moto"),
    );
  });

  it("keeps a tab outside the address out of the title", async () => {
    renderRecord({ value: "history" });

    await waitFor(() => expect(document.title).toBe("Kindakte – OGS – moto"));
  });

  it("drops the tab when its page unmounts", async () => {
    const view = renderRecord({ value: "history", inUrl: true });
    await waitFor(() =>
      expect(document.title).toBe("Verlauf – Kindakte – OGS – moto"),
    );

    view.rerender(
      <RouteTitle hostSurface="ogs" messages={MESSAGES}>
        <div />
      </RouteTitle>,
    );

    await waitFor(() => expect(document.title).toBe("Kindakte – OGS – moto"));
  });
});
