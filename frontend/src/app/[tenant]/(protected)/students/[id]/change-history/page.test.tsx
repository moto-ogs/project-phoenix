import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "~/lib/swr/testing";
import { catalogText } from "~/test/error-catalog-text";
import StudentChangeHistoryPage from "./page";

vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1", token: "test-token" } },
  }),
}));

// The child's detail also reads the account's own groups; none here.
vi.mock("~/lib/usercontext-api", () => ({
  userContextService: {
    getMyEducationalGroups: () => Promise.resolve([]),
    getMySupervisedGroups: () => Promise.resolve([]),
  },
}));

// Real SWR with a fresh cache per render.
function SWRTestCache({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: SWRTestCache });
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useSearchParams: () => ({
    get: (key: string) => (key === "from" ? "/students/search" : null),
  }),
}));

vi.mock("~/lib/session-cache", async () => {
  const { transportFetch } =
    await vi.importActual<typeof import("~/lib/api-error")>("~/lib/api-error");
  // The session gate is tested in session-cache; here only the transport.
  return {
    sessionFetch: (url: string, init?: RequestInit) =>
      transportFetch(url, init),
  };
});

vi.mock("~/lib/breadcrumb-context", () => ({
  useStudentHistoryBreadcrumb: vi.fn(),
}));

// Der Rückweg der Kopfkarte (TenantPage) als Link mit seinem Ziel.
vi.mock("~/components/ui/back-link", () => ({
  BackLink: ({ href, label }: { href: string; label: string }) => (
    <a data-testid="back-button" href={href}>
      {label}
    </a>
  ),
}));

const student = {
  id: "1",
  first_name: "Emma",
  second_name: "Müller",
  name: "Emma Müller",
  school_class: "3b",
};

function stubFetch(history: () => Response) {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/change-history")
      ? history()
      : Response.json({ data: student }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("StudentChangeHistoryPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a failed load in place with retry and request ID", async () => {
    let calls = 0;
    const fetchMock = stubFetch(() => {
      calls += 1;
      return calls === 1
        ? Response.json(
            { status: "error", code: "general.server", instance: "req-ch" },
            { status: 500 },
          )
        : Response.json({ data: [] });
    });

    render(<StudentChangeHistoryPage />);

    expect(
      await screen.findByText(
        "Die Liste der Änderungen konnte nicht bearbeitet werden. Bitte versuchen Sie es später erneut.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vorgangskennung kopieren" }),
    ).toHaveTextContent("req-ch");
    // #2517: keine Zählung aus einer Liste, die nie geladen wurde.
    expect(
      screen.getByText(
        catalogText("general.server", "die Liste der Änderungen"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 Einträge/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    expect(
      await screen.findByText(/Noch keine Änderungen erfasst\./),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => url.endsWith("/change-history")),
      ).toHaveLength(2),
    );
  });

  it("names the permission class for a 403", async () => {
    stubFetch(() =>
      Response.json(
        { status: "error", code: "general.permission" },
        { status: 403 },
      ),
    );

    render(<StudentChangeHistoryPage />);

    expect(
      await screen.findByText(
        "Für die Liste der Änderungen fehlt Ihnen die Berechtigung. Bitte fragen Sie die Schule.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("back-button")).toHaveAttribute(
      "href",
      "/test-tenant/students/search",
    );
  });

  it("says the child was not found for a 404", async () => {
    stubFetch(() => new Response(null, { status: 404 }));

    render(<StudentChangeHistoryPage />);

    expect(await screen.findByText("Kind nicht gefunden.")).toBeInTheDocument();
  });
});
