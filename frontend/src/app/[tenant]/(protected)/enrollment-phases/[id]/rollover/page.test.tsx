import { Suspense } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "~/lib/swr/testing";

import type { Phase } from "~/lib/enrollment-phase-api";

vi.unmock("swr");

const mocks = vi.hoisted(() => ({
  getPhase: vi.fn(),
  replace: vi.fn(),
  tenantMutate: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/lib/enrollment-phase-api", () => ({
  getPhase: mocks.getPhase,
}));

vi.mock("~/lib/hooks/use-require-permission", () => ({
  useRequirePermission: () => ({ isReady: true }),
}));

vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("~/lib/swr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/swr")>()),
  useTenantMutate: () => mocks.tenantMutate,
}));

vi.mock("~/contexts/ToastContext", () => ({
  useApiLoadError: () => ({ error: null, show: vi.fn(), clear: vi.fn() }),
}));

vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: () => <div data-testid="tenant-page" />,
}));

// The form owns its own submit; the page only decides where it leads.
vi.mock("~/components/enrollment/rollover-form", () => ({
  RolloverForm: ({
    onCancel,
    onSuccess,
  }: {
    onCancel: () => void;
    onSuccess: (result: unknown) => void;
  }) => (
    <div data-testid="rollover-form">
      <button type="button" onClick={onCancel}>
        cancel
      </button>
      <button type="button" onClick={() => onSuccess({})}>
        success
      </button>
    </div>
  ),
}));

import MobileRolloverPage from "./page";

async function renderPage() {
  await act(async () => {
    render(
      <SessionProvider
        session={{
          user: { id: "staff-7", scope: "tenant", tenantId: "42" },
          expires: "2099-01-01",
        }}
        refetchOnWindowFocus={false}
      >
        <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
          <Suspense fallback={null}>
            <MobileRolloverPage params={Promise.resolve({ id: "7" })} />
          </Suspense>
        </SWRConfig>
      </SessionProvider>,
    );
  });
  return screen.findByTestId("rollover-form");
}

describe("MobileRolloverPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPhase.mockResolvedValue({ id: "7" } as unknown as Phase);
  });

  // #5001: both exits used to set location.href and rebuilt the whole shell.
  it("returns to the start page through the router when cancelled", async () => {
    await renderPage();

    fireEvent.click(screen.getByText("cancel"));

    expect(mocks.replace).toHaveBeenCalledWith("/home");
    expect(mocks.tenantMutate).not.toHaveBeenCalled();
  });

  it("refreshes the expiry warnings and returns through the router after success", async () => {
    await renderPage();

    fireEvent.click(screen.getByText("success"));

    expect(mocks.tenantMutate).toHaveBeenCalledWith(
      "enrollment-phase-expiry-warnings",
    );
    expect(mocks.replace).toHaveBeenCalledWith("/home");
  });
});
