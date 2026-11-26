import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSWRScope } from "~/lib/swr/scope";
import { useInvalidateFamily } from "~/lib/swr";
import { studentKeys } from "~/lib/swr/portal-keys";
import { SWRConfig } from "~/lib/swr/testing";
import { catalogText } from "~/test/error-catalog-text";
import StudentChangeHistoryPage from "./page-content";

vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1", token: "test-token" } },
  }),
}));

// The child's detail also reads the account's own groups; none here.
vi.mock("~/lib/usercontext-api", () => ({
  userContextService: {},
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

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

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
  beforeEach(() => resetSWRScope({ revalidate: false }));
  afterEach(() => vi.unstubAllGlobals());

  it.each([401, 403])(
    "withdraws cached history on %s until an authorized read succeeds",
    async (refusalStatus) => {
      let status = 200;
      const entry = {
        id: "1",
        field: "health_info",
        old_value: "vorheriger Wert",
        new_value: "geschützter Wert",
        edited_by: "Team",
        changed_at: "2026-09-09T09:00:00Z",
      };
      stubFetch(() =>
        status === 200
          ? Response.json({ data: [entry] })
          : Response.json(
              {
                code:
                  status === 503 ? "general.unavailable" : "general.permission",
              },
              { status },
            ),
      );
      let reload!: () => Promise<unknown>;
      function Probe() {
        const invalidate = useInvalidateFamily();
        reload = () => invalidate(studentKeys.changeHistory("1"));
        return null;
      }
      const view = render(
        <>
          <StudentChangeHistoryPage />
          <Probe />
        </>,
      );
      expect(await screen.findByText(entry.new_value)).toBeVisible();
      status = 503;
      await act(async () => {
        await reload();
      });
      expect(screen.getByText(entry.new_value)).toBeVisible();
      status = refusalStatus;
      await act(async () => {
        await reload();
      });
      if (status === 403)
        expect(
          await screen.findByText(
            catalogText("general.permission", "die Liste der Änderungen"),
          ),
        ).toBeVisible();
      else
        await waitFor(() =>
          expect(
            document.querySelector('[aria-busy="true"]'),
          ).toBeInTheDocument(),
        );
      expect(screen.queryByText(entry.new_value)).not.toBeInTheDocument();
      expect(screen.queryByText(entry.old_value)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Noch keine Änderungen erfasst/),
      ).not.toBeInTheDocument();
      status = 503;
      await act(async () => {
        await reload();
      });
      expect(screen.queryByText(entry.new_value)).not.toBeInTheDocument();
      view.rerender(<Probe />);
      view.rerender(
        <>
          <StudentChangeHistoryPage />
          <Probe />
        </>,
      );
      expect(screen.queryByText(entry.new_value)).not.toBeInTheDocument();
      status = 200;
      await act(async () => {
        await reload();
      });
      expect(await screen.findByText(entry.new_value)).toBeVisible();
    },
  );

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
        "Die Liste der Änderungen konnte nicht bearbeitet werden. Bitte versuche es später erneut.",
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
    // Statuszeile: Zahl und Wort stehen in eigenen Elementen (#7402).
    expect(screen.queryByText(/^(\d+ )?Einträge?$/)).not.toBeInTheDocument();

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
        "Für die Liste der Änderungen fehlt dir die Berechtigung. Bitte frage die Schule.",
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
