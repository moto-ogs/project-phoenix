import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");
const { mockFetchOrganization } = vi.hoisted(() => ({
  mockFetchOrganization: vi.fn(),
}));

vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerOrganization: mockFetchOrganization,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "A",
        scope: "org",
        orgId: "7",
        permissions: ["traeger_overview:read"],
      },
    },
    status: "authenticated",
  }),
}));

import TraegerModulesPage from "./page";

function renderPage() {
  return render(
    <ToastProvider>
      <TraegerModulesPage />
    </ToastProvider>,
    {
      wrapper: ({ children }) => (
        <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
          {children}
        </SWRConfig>
      ),
    },
  );
}

describe("TraegerModulesPage (#6052)", () => {
  beforeEach(() => {
    mockFetchOrganization.mockReset();
  });

  it("shows which moto modules count as booked for the Träger", async () => {
    mockFetchOrganization.mockResolvedValue({
      id: "7",
      name: "Ganztag Nord e. V.",
      testSystem: false,
      federalStates: [],
      bookedModules: ["vertraege", "elternbeitraege"],
    });
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Gebuchte moto-Module" }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getByText("Nicht gebucht")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Gebucht")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Gebucht")).toBeInTheDocument();
  });

  it("reports a failed read instead of an empty list", async () => {
    mockFetchOrganization.mockRejectedValue(
      new ApiError("upstream failed", 500),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Nicht gebucht")).toBeNull();
  });
});
