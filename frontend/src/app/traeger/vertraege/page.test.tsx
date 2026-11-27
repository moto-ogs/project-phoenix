import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { deferred } from "~/test/helpers/form-modal-pending";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import {
  SAVED_BUT_STALE_SUFFIX,
  useRefreshAfterWrite,
} from "~/lib/hooks/use-refresh-after-write";
import { reloadDocument } from "~/lib/reload-document";
import { catalogText } from "~/test/error-catalog-text";
import { releaseFakeTimers } from "~/test/clock";
import {
  DESKTOP_WIDTH,
  PHONE_WIDTH,
  setViewportWidth,
} from "~/test/helpers/viewport";
import type {
  CareContractList,
  CareContractSummary,
  ContractCandidate,
} from "~/lib/traeger-care-contracts-api";

const { api, mockPush, bffFile, downloadBlob } = vi.hoisted(() => ({
  api: {
    fetchCareContracts: vi.fn(),
    fetchContractCandidates: vi.fn(),
    fetchConclusionModes: vi.fn(),
    fetchTraegerSchools: vi.fn(),
    createCareContracts: vi.fn(),
    sendCareContracts: vi.fn(),
  },
  mockPush: vi.fn(),
  bffFile: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.unmock("swr");
vi.mock("~/lib/traeger-care-contracts-api", () => api);
vi.mock("~/lib/bff-fetch", async (original) => ({
  ...(await original<typeof import("~/lib/bff-fetch")>()),
  bffFile,
}));
vi.mock("~/lib/file-download", async (original) => ({
  ...(await original<typeof import("~/lib/file-download")>()),
  downloadBlob,
}));
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({
    data: {
      user: {
        id: "A",
        scope: "org",
        orgId: "7",
        permissions: ["traeger_contracts:manage", "traeger_overview:read"],
      },
    },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerSchools: api.fetchTraegerSchools,
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => "/vertraege",
  useSearchParams: () => new URLSearchParams(),
}));

import TraegerVertraegePage from "./page-content";
import {
  expectPageReloadedAfterRefusal,
  resetPageReloads,
} from "~/test/helpers/refused-refresh";

const DRAFT: CareContractSummary = {
  changeAwaitsSignature: false,
  id: "7",
  status: "entwurf",
  schoolId: "3",
  schoolName: "OGS Am Lindenhof",
  childFirstName: "Lina",
  childLastName: "Muster",
  moduleNames: ["Offene Ganztagsschule"],
  modulesText: "Offene Ganztagsschule",
  partyName: "Erika Muster",
  partyEmail: "erika@example.org",
  effectiveFrom: "2027-08-01",
  createdAt: "2026-09-01T08:00:00Z",
  sentAt: null,
  concluded: null,
  endsOn: null,
  studentId: null,
  imported: false,
  followsBookings: false,
  requestChildId: null,
};

const SENT: CareContractSummary = {
  ...DRAFT,
  id: "8",
  status: "versendet",
  childFirstName: "Ben",
  sentAt: "2026-09-02T08:00:00Z",
};

const CANDIDATE: ContractCandidate = {
  schoolId: "3",
  requestChildId: "41",
  schoolName: "OGS Am Lindenhof",
  childFirstName: "Mia",
  childLastName: "Kern",
  guardianName: "Paula Kern",
  guardianEmail: "paula@example.org",
  phaseName: "2027/28",
  services: [
    {
      weekday: "mon",
      careOfferingId: "5",
      moduleName: "Kurzbetreuung",
      endsAt: "14:00",
      lastDay: null,
    },
    {
      weekday: "tue",
      careOfferingId: "6",
      moduleName: "Ganztag",
      endsAt: "16:30",
      lastDay: null,
    },
  ],
  effectiveFrom: "2027-08-01",
  templateIssue: null,
  modulesText: "Kurzbetreuung und Ganztag",
  acceptanceIssue: null,
  renewal: false,
  mailBlock: null,
  importedContractId: null,
};

function renderPage(otherContent?: ReactNode) {
  render(
    <TraegerResourceTestProvider>
      <TraegerVertraegePage />
      {otherContent}
    </TraegerResourceTestProvider>,
  );
}

function OtherRefresh({ reload }: { reload: () => Promise<void> }) {
  const { refresh } = useRefreshAfterWrite("die andere Liste", reload);
  return <button onClick={() => void refresh()}>Andere Liste laden</button>;
}

function downloadCsv() {
  const [menu] = screen.getAllByRole("button", { name: "Weitere Aktionen" });
  fireEvent.click(menu!);
  fireEvent.click(screen.getByRole("menuitem", { name: /CSV/ }));
}

function sortByChild() {
  fireEvent.click(
    screen.getByRole("button", { name: "Kind – Spalte sortieren" }),
  );
}

describe("TraegerVertraegePage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    mockPush.mockReset();
    bffFile.mockReset();
    downloadBlob.mockReset();
    api.fetchCareContracts.mockResolvedValue({
      contracts: [DRAFT, SENT],
      counts: { entwurf: 1, versendet: 1 },
      hasMore: false,
    });
    api.fetchTraegerSchools.mockResolvedValue([
      { id: "3", name: "OGS Am Lindenhof" },
    ]);
    api.fetchConclusionModes.mockResolvedValue([
      { schoolId: "3", schoolName: "OGS Am Lindenhof", mode: "nachtraeglich" },
    ]);
    api.fetchContractCandidates.mockResolvedValue([
      CANDIDATE,
      {
        ...CANDIDATE,
        requestChildId: "42",
        childFirstName: "Tom",
        templateIssue: "template_missing",
      },
      {
        ...CANDIDATE,
        requestChildId: "43",
        childFirstName: "Ida",
        templateIssue: "templates_differ",
      },
    ]);
  });

  it("lists the contracts with status and names the children without one", async () => {
    renderPage();

    expect((await screen.findAllByText("Lina Muster"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("Entwurf")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Versendet")[0]).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Verträge erstellen \(3\)/ }),
    ).toBeInTheDocument();
  });

  it("shows a child an imported contract covers, held back, and does not count it as waiting", async () => {
    api.fetchContractCandidates.mockResolvedValue([
      CANDIDATE,
      {
        ...CANDIDATE,
        requestChildId: "45",
        childFirstName: "Noah",
        templateIssue: "imported_contract",
        importedContractId: "79",
      },
    ]);
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /Verträge erstellen \(1\)/ }),
    );
    expect(
      await screen.findByText("Hat schon einen importierten Vertrag"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Der importierte Vertrag Nr\. 79 gilt für dieses Kind/),
    ).toBeInTheDocument();
  });

  it("withdraws cached contracts as soon as loading another page refuses access", async () => {
    api.fetchCareContracts.mockResolvedValueOnce({
      contracts: [SENT],
      counts: { entwurf: 1100, versendet: 1 },
      hasMore: true,
    });
    renderPage();
    expect((await screen.findAllByText("Ben Muster"))[0]).toBeVisible();
    api.fetchCareContracts
      .mockRejectedValueOnce(new ApiError("refused", 403))
      .mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Weitere Verträge laden (1 von 1101)",
      }),
    );
    // Anker: die ursprüngliche Verweigerung ist sichtbar, ohne einen zweiten Abruf abzuwarten.
    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Verträge"),
      ),
    ).toBeVisible();
    expect(screen.queryByText("Ben Muster")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("withdraws the newly sorted list when a download from the previous sort is refused", async () => {
    const file = deferred<Response>();
    const other = deferred<void>();
    bffFile.mockReturnValueOnce(file.promise);
    resetPageReloads();
    renderPage(<OtherRefresh reload={() => other.promise} />);
    await screen.findAllByText("Lina Muster");
    downloadCsv();
    api.fetchCareContracts.mockResolvedValueOnce({
      contracts: [SENT],
      counts: { versendet: 1 },
      hasMore: false,
    });
    sortByChild();
    expect((await screen.findAllByText("Ben Muster"))[0]).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Andere Liste laden" }));

    api.fetchCareContracts.mockImplementation(
      () => new Promise(() => undefined),
    );
    await act(async () => file.reject(new ApiError("refused", 403)));
    // Anker: die Verweigerung steht anstelle der neu sortierten Liste.
    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Verträge"),
      ),
    ).toBeVisible();
    expect(screen.queryByText("Ben Muster")).not.toBeInTheDocument();
    await act(async () => other.resolve());
    expect(reloadDocument).not.toHaveBeenCalled();
  });

  it("discards a download from the previous sort when the new list is refused", async () => {
    const file = deferred<Response>();
    bffFile.mockReturnValueOnce(file.promise);
    renderPage();
    await screen.findAllByText("Lina Muster");
    downloadCsv();
    expect(bffFile).toHaveBeenCalledOnce();
    api.fetchCareContracts.mockRejectedValue(new ApiError("refused", 403));
    sortByChild();
    // Anker: die neu sortierte Liste hat eine Verweigerung erhalten.
    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Verträge"),
      ),
    ).toBeVisible();
    await act(async () => file.resolve(new Response("Lina Muster")));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("does not treat a refused first contract read as a refusal of another refresh", async () => {
    const first = deferred<CareContractList>();
    const other = deferred<void>();
    api.fetchCareContracts
      .mockReturnValueOnce(first.promise)
      .mockRejectedValue(new ApiError("refused", 403));
    resetPageReloads();
    renderPage(<OtherRefresh reload={() => other.promise} />);
    fireEvent.click(screen.getByRole("button", { name: "Andere Liste laden" }));
    await act(async () => first.reject(new ApiError("refused", 403)));
    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Verträge"),
      ),
    ).toBeVisible();
    await act(async () => other.resolve());
    expect(reloadDocument).not.toHaveBeenCalled();
  });

  it("withdraws the list but does not reload the document when a superseded sort is refused", async () => {
    const oldSort = deferred<CareContractList>();
    const other = deferred<void>();
    api.fetchCareContracts.mockReturnValueOnce(oldSort.promise);
    resetPageReloads();
    renderPage(<OtherRefresh reload={() => other.promise} />);
    await waitFor(() => expect(api.fetchCareContracts).toHaveBeenCalledOnce());
    sortByChild();
    expect((await screen.findAllByText("Lina Muster"))[0]).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Andere Liste laden" }));
    api.fetchCareContracts.mockReturnValue(new Promise(() => undefined));
    await act(async () => oldSort.reject(new ApiError("refused", 403)));
    // Anker: Die Ablehnung gilt für alle Sortierungen derselben Liste.
    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Verträge"),
      ),
    ).toBeVisible();
    expect(screen.queryByText("Lina Muster")).not.toBeInTheDocument();
    await act(async () => other.resolve());
    expect(reloadDocument).not.toHaveBeenCalled();
  });

  it("uses the mobile sort for the first page and keeps it for the download", async () => {
    setViewportWidth(PHONE_WIDTH);
    onTestFinished(() => setViewportWidth(DESKTOP_WIDTH));
    renderPage();
    await screen.findAllByText("Lina Muster");
    const sort = screen.getByRole("combobox", { name: "Sortieren nach" });
    expect(
      screen.getByTestId("data-table-stacked").parentElement,
    ).toContainElement(sort);
    fireEvent.click(sort);
    fireEvent.click(screen.getByRole("option", { name: "Kind: Z bis A" }));
    expect(api.fetchCareContracts).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, sort: "child", order: "desc" }),
    );
    expect(sort).toHaveTextContent("Kind: Z bis A");
    setViewportWidth(DESKTOP_WIDTH);
    await screen.findAllByText("Lina Muster");
    bffFile.mockResolvedValueOnce(new Response("Verträge"));
    const [menu] = await screen.findAllByRole("button", {
      name: "Weitere Aktionen",
    });
    fireEvent.click(menu!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));
    expect(bffFile).toHaveBeenCalledWith(
      "org",
      "GET /traeger/contracts/export",
      {
        query: expect.objectContaining({ sort: "child", order: "desc" }),
      },
    );
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
  });

  it("shows the school and an open end in the stacked row when sorting by school", async () => {
    setViewportWidth(PHONE_WIDTH);
    onTestFinished(() => setViewportWidth(DESKTOP_WIDTH));
    api.fetchCareContracts.mockResolvedValue({
      contracts: [{ ...DRAFT, status: "gekuendigt", endsOn: null }],
      counts: { gekuendigt: 1 },
      hasMore: false,
    });
    renderPage();
    await screen.findAllByText("Lina Muster");
    fireEvent.click(screen.getByRole("combobox", { name: "Sortieren nach" }));
    fireEvent.click(
      screen.getByRole("option", { name: "Betreuungsort: A bis Z" }),
    );
    const stacked = within(screen.getByTestId("data-table-stacked"));
    expect(await stacked.findByText("OGS Am Lindenhof")).toBeVisible();
    expect(stacked.getByText("Ende festlegen")).toBeVisible();
  });

  it("keeps school and status filters available while the new sort is loading or offline", async () => {
    api.fetchTraegerSchools.mockResolvedValue([
      { id: "3", name: "OGS Am Lindenhof" },
      { id: "4", name: "OGS Am Park" },
    ]);
    const sorted = deferred<CareContractList>();
    renderPage();
    await screen.findAllByText("Lina Muster");
    api.fetchCareContracts.mockReturnValueOnce(sorted.promise);
    sortByChild();
    expect(screen.getByRole("button", { name: "Alle Schulen" })).toBeVisible();
    await act(async () => sorted.reject(new ApiError("down", 503)));
    expect(
      await screen.findByRole("button", { name: "Wiederholen" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Alle Schulen" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Alle Status" }));
    expect(screen.getByRole("option", { name: "Versendet" })).toBeVisible();
  });

  it("keeps the focused sort control when a sorted read fails without showing the old rows", async () => {
    renderPage();
    await screen.findAllByText("Lina Muster");
    const child = screen.getByRole("button", {
      name: "Kind – Spalte sortieren",
    });
    child.focus();
    api.fetchCareContracts.mockRejectedValueOnce(new ApiError("down", 503));
    fireEvent.click(child);
    expect(
      await screen.findByRole("button", { name: "Wiederholen" }),
    ).toBeVisible();
    // Anker: Der Fehler ersetzt die alten Zeilen, nicht die Sortierung.
    expect(child).toHaveFocus();
    expect(screen.queryByText("Lina Muster")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Beginn – Spalte sortieren" }),
    );
    expect((await screen.findAllByText("Lina Muster"))[0]).toBeVisible();
  });

  it("orders every contract of the filter in the database and names the offer in its own column", async () => {
    renderPage();
    expect((await screen.findAllByText("Lina Muster"))[0]).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Angebot" })).toBeVisible();
    // The plain list asks for no order: the newest contract comes first.
    expect(api.fetchCareContracts).toHaveBeenLastCalledWith({
      status: undefined,
      schoolId: "",
      search: "",
      offset: 0,
    });

    api.fetchCareContracts.mockResolvedValue({
      contracts: [SENT, DRAFT],
      counts: { entwurf: 1, versendet: 1 },
      hasMore: true,
    });
    const childSort = screen.getByRole("button", {
      name: "Kind – Spalte sortieren",
    });
    childSort.focus();
    fireEvent.click(childSort);
    expect(childSort).toHaveFocus();
    await waitFor(() =>
      expect(api.fetchCareContracts).toHaveBeenLastCalledWith({
        status: undefined,
        schoolId: "",
        search: "",
        sort: "child",
        order: "asc",
        offset: 0,
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Kind – aufsteigend sortiert",
      }),
    );
    await waitFor(() =>
      expect(api.fetchCareContracts).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "child", order: "desc" }),
      ),
    );
    // An order shows the same contracts again: what is ticked stays ticked.
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Vertrag von Lina Muster auswählen",
      }),
    );
    expect(await screen.findByText("1 Vertrag ausgewählt")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Beginn – Spalte sortieren" }),
    );
    await waitFor(() =>
      expect(api.fetchCareContracts).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "start", order: "asc" }),
      ),
    );
    expect(await screen.findByText("1 Vertrag ausgewählt")).toBeVisible();
    fireEvent.click(
      await screen.findByRole("button", { name: "Kind – Spalte sortieren" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Kind – aufsteigend sortiert",
      }),
    );
    // The next page continues the same order.
    fireEvent.click(
      await screen.findByRole("button", { name: /^Weitere Verträge laden/ }),
    );
    await waitFor(() =>
      expect(api.fetchCareContracts).toHaveBeenLastCalledWith({
        status: undefined,
        schoolId: "",
        search: "",
        sort: "child",
        order: "desc",
        offset: 2,
      }),
    );
  });

  it("replaces the loaded contracts when status sorting restarts the list", async () => {
    const initial = {
      contracts: [DRAFT],
      counts: { entwurf: 1, versendet: 1 },
      hasMore: true,
      revision: "v1:0:11",
    };
    api.fetchCareContracts.mockResolvedValue(initial);
    renderPage();
    await screen.findAllByText("Lina Muster");
    fireEvent.click(
      screen.getByRole("button", { name: "Status – Spalte sortieren" }),
    );
    const more = await screen.findByRole("button", {
      name: /^Weitere Verträge laden/,
    });
    api.fetchCareContracts.mockResolvedValueOnce({
      ...initial,
      contracts: [SENT],
      revision: "v1:0:22",
    });
    fireEvent.click(more);
    expect((await screen.findAllByText("Ben Muster"))[0]).toBeInTheDocument();
    expect(screen.queryByText("Lina Muster")).toBeNull();
    expect(api.fetchCareContracts).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sort: "status",
        order: "asc",
        offset: 1,
        revision: "v1:0:11",
      }),
    );
  });

  it("loads older contracts and sends filters to the server", async () => {
    api.fetchCareContracts
      .mockResolvedValueOnce({
        contracts: [SENT],
        counts: { entwurf: 1100, versendet: 1 },
        hasMore: true,
        revision: "v1:0:11",
      })
      .mockResolvedValueOnce({
        contracts: [DRAFT],
        counts: { entwurf: 1100, versendet: 1 },
        hasMore: true,
        revision: "v1:1:22",
      })
      .mockResolvedValueOnce({
        contracts: [{ ...DRAFT, id: "9", childFirstName: "Mia" }],
        counts: { entwurf: 1100, versendet: 1 },
        hasMore: false,
        revision: "v1:2:33",
      });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Weitere Verträge laden (1 von 1101)",
      }),
    );
    expect((await screen.findAllByText("Lina Muster"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("Ben Muster")[0]).toBeInTheDocument();
    expect(api.fetchCareContracts).toHaveBeenLastCalledWith({
      status: undefined,
      schoolId: "",
      search: "",
      offset: 1,
      revision: "v1:0:11",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Weitere Verträge laden (2 von 1101)",
      }),
    );
    expect((await screen.findAllByText("Mia Muster"))[0]).toBeVisible();
    expect(screen.getAllByText("Ben Muster")[0]).toBeVisible();
    expect(api.fetchCareContracts).toHaveBeenLastCalledWith({
      status: undefined,
      schoolId: "",
      search: "",
      offset: 2,
      revision: "v1:1:22",
    });
    fireEvent.change(
      screen.getAllByPlaceholderText("Kind, Eltern oder Angebot suchen")[0]!,
      { target: { value: "Mia" } },
    );
    await waitFor(() =>
      expect(api.fetchCareContracts).toHaveBeenLastCalledWith({
        status: undefined,
        schoolId: "",
        search: "Mia",
        offset: 0,
      }),
    );
  });

  it("cancels a pending search when resetting filters on an empty list", async () => {
    api.fetchCareContracts.mockImplementation(
      ({ status }: { status?: string }) =>
        Promise.resolve({
          contracts: status ? [] : [DRAFT, SENT],
          counts: { entwurf: 1, versendet: 1 },
          hasMore: false,
        }),
    );
    renderPage();
    await screen.findAllByText("Lina Muster");
    fireEvent.click(screen.getByRole("button", { name: "Alle Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Entwurf (1)" }));
    const reset = await screen.findByRole("button", {
      name: "Filter zurücksetzen",
    });
    const [search] = screen.getAllByPlaceholderText(
      "Kind, Eltern oder Angebot suchen",
    );

    vi.useFakeTimers();
    try {
      fireEvent.change(search!, { target: { value: "Ben" } });
      expect(search).toHaveValue("Ben");
      fireEvent.click(reset);
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(search).toHaveValue("");
    } finally {
      releaseFakeTimers();
    }

    await screen.findAllByText("Lina Muster");
    expect(api.fetchCareContracts).not.toHaveBeenCalledWith(
      expect.objectContaining({ search: "Ben" }),
    );
  });

  it("marks only imported contracts without a child record", async () => {
    api.fetchCareContracts.mockResolvedValue({
      contracts: [
        { ...SENT, id: "8", childFirstName: "Ohne", imported: true },
        {
          ...SENT,
          id: "9",
          childFirstName: "Verknüpft",
          imported: true,
          studentId: "12",
        },
        DRAFT,
      ],
      counts: { versendet: 2, entwurf: 1 },
      hasMore: false,
    });
    renderPage();
    await screen.findAllByText("Verknüpft Muster");
    // One marker: the linked import and the application's draft have none.
    expect(screen.getAllByText("Ohne Kinderakte")).toHaveLength(1);
  });

  it("keeps one visible head action; import and download sit in the page menu", async () => {
    renderPage();
    await screen.findAllByText("Lina Muster");

    expect(
      screen.queryByRole("link", { name: "Verträge importieren" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Verträge herunterladen" }),
    ).not.toBeInTheDocument();
    // The head renders the menu once per layout (phone title row, search
    // row); both open the same entries.
    const [menu] = screen.getAllByRole("button", { name: "Weitere Aktionen" });
    fireEvent.click(menu!);
    expect(
      screen.getByRole("menuitem", { name: /Verträge importieren/ }),
    ).toHaveAttribute("href", "/vertraege/import");
    expect(
      screen.getByRole("menuitem", { name: /Module neu zuordnen/ }),
    ).toHaveAttribute("href", "/vertraege/module-zuordnen");
    expect(
      screen.getByRole("menuitem", { name: /Mit Kinderakten verknüpfen/ }),
    ).toHaveAttribute("href", "/vertraege/verknuepfen");
    expect(screen.getByRole("menuitem", { name: /CSV/ })).toBeInTheDocument();
  });

  it("opens the conditions from the create dialog in a new tab", async () => {
    renderPage();
    await screen.findAllByText("Lina Muster");
    fireEvent.click(screen.getByRole("button", { name: /Verträge erstellen/ }));

    // The ticked children stay in the dialog; the conditions open beside it.
    expect(
      await screen.findByRole("link", {
        name: "Bedingungen festlegen, neuer Tab",
      }),
    ).toHaveAttribute("target", "_blank");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("creates one draft per child over its modules, only with equal conditions", async () => {
    api.createCareContracts.mockResolvedValue({
      created: [DRAFT],
      skipped: [],
    });
    renderPage();
    await screen.findAllByText("Lina Muster");

    fireEvent.click(screen.getByRole("button", { name: /Verträge erstellen/ }));
    expect(
      await screen.findByText(
        /Für 1 Kind fehlen die Vertragsbedingungen eines Moduls\. Bei 1 Kind haben die gebuchten Module verschiedene Bedingungen\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tom Kern auswählen")).toBeDisabled();
    expect(screen.getByLabelText("Ida Kern auswählen")).toBeDisabled();
    expect(
      screen.getByText("Bedingungen der Module weichen ab"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Mo bis 14:00 · Di bis 16:30")[0],
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "1 Entwurf erstellen" }),
    );

    await waitFor(() =>
      expect(api.createCareContracts).toHaveBeenCalledWith([CANDIDATE]),
    );
    expect(
      await screen.findByText(/1 Entwurf ist erstellt/),
    ).toBeInTheDocument();
  });

  it("reads the other filters' lists again after creating drafts", async () => {
    api.createCareContracts.mockResolvedValue({
      created: [DRAFT],
      skipped: [],
    });
    renderPage();
    await screen.findAllByText("Lina Muster");
    fireEvent.click(screen.getByRole("button", { name: "Alle Status" }));
    fireEvent.click(await screen.findByRole("option", { name: /^Entwurf/ }));
    await waitFor(() =>
      expect(api.fetchCareContracts).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "entwurf" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Verträge erstellen/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "1 Entwurf erstellen" }),
    );
    expect(
      await screen.findByText(/1 Entwurf ist erstellt/),
    ).toBeInTheDocument();
    api.fetchCareContracts.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^Entwurf \(/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Alle Status" }));
    await waitFor(() =>
      expect(api.fetchCareContracts).toHaveBeenCalledWith({
        status: undefined,
        schoolId: "",
        search: "",
        offset: 0,
      }),
    );
  });

  it("saves a pending download even when creating drafts changes the filter", async () => {
    const file = deferred<Response>();
    bffFile.mockReturnValueOnce(file.promise);
    api.createCareContracts.mockResolvedValue({
      created: [DRAFT],
      skipped: [],
    });
    renderPage();
    await screen.findAllByText("Lina Muster");
    downloadCsv();
    fireEvent.click(screen.getByRole("button", { name: /Verträge erstellen/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "1 Entwurf erstellen" }),
    );
    await waitFor(() =>
      expect(api.fetchCareContracts).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "entwurf" }),
      ),
    );
    await act(async () => file.resolve(new Response("Lina Muster")));
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "betreuungsvertraege.csv",
    );
  });

  it("sends the selected drafts", async () => {
    api.sendCareContracts.mockResolvedValue({ sent: ["7"], skipped: [] });
    renderPage();
    await screen.findAllByText("Lina Muster");

    fireEvent.click(
      screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "1 Entwurf senden" }),
    );

    await waitFor(() =>
      expect(api.sendCareContracts).toHaveBeenCalledWith(["7"]),
    );
    expect(
      await screen.findByText(/1 Vertrag ist unterwegs/),
    ).toBeInTheDocument();
  });

  it("opens a contract from its row", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByText("Offene Ganztagsschule"))[0]!);

    expect(mockPush).toHaveBeenCalledWith("/vertraege/7");
  });

  it("shows how the contracts of each school come about", async () => {
    api.fetchConclusionModes.mockResolvedValue([
      { schoolId: "3", schoolName: "OGS Am Lindenhof", mode: "bei_annahme" },
      { schoolId: "4", schoolName: "OGS Nord", mode: "nachtraeglich" },
    ]);
    renderPage();

    const list = await screen.findByRole("list", {
      name: "Abschluss pro Schule",
    });
    expect(list).toHaveTextContent("OGS Am LindenhofBei der Annahme");
    expect(list).toHaveTextContent("OGS NordSpäter verschicken");
    expect(
      screen.getByText(/entsteht der Vertrag von selbst, sobald die Schule/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "In den Einstellungen ändern" }),
    ).toHaveAttribute("href", "/einstellungen?bereich=enrollment");
  });

  it("marks a school whose accepted children got no contract for lack of consent", async () => {
    api.fetchConclusionModes.mockResolvedValue([
      { schoolId: "3", schoolName: "OGS Am Lindenhof", mode: "bei_annahme" },
      { schoolId: "4", schoolName: "OGS Nord", mode: "nachtraeglich" },
    ]);
    api.fetchContractCandidates.mockResolvedValue([
      CANDIDATE,
      {
        ...CANDIDATE,
        requestChildId: "44",
        acceptanceIssue: "acceptance_missing",
      },
      {
        ...CANDIDATE,
        requestChildId: "45",
        acceptanceIssue: "acceptance_changed",
      },
      {
        ...CANDIDATE,
        schoolId: "4",
        requestChildId: "46",
        acceptanceIssue: "acceptance_missing",
      },
    ]);
    renderPage();

    const list = await screen.findByRole("list", {
      name: "Abschluss pro Schule",
    });
    const [lindenhof, nord] = within(list).getAllByRole("listitem");
    expect(lindenhof).toHaveTextContent(
      "OGS Am Lindenhof2 Kinder ohne Zustimmung, kein VertragBei der Annahme",
    );
    // A school that sends its contracts later has no consent to miss.
    expect(nord).toHaveTextContent("OGS NordSpäter verschicken");
    expect(nord).not.toHaveTextContent(/kein Vertrag/);
  });

  it("does not offer manual drafts for schools concluding at acceptance and says why each child waits", async () => {
    api.fetchConclusionModes.mockResolvedValue([
      { schoolId: "3", schoolName: "OGS Am Lindenhof", mode: "bei_annahme" },
    ]);
    api.fetchContractCandidates.mockResolvedValue([
      CANDIDATE,
      {
        ...CANDIDATE,
        requestChildId: "44",
        childFirstName: "Ben",
        acceptanceIssue: "acceptance_changed",
      },
      {
        ...CANDIDATE,
        requestChildId: "45",
        childFirstName: "Ole",
        acceptanceIssue: "acceptance_missing",
      },
      {
        ...CANDIDATE,
        requestChildId: "46",
        childFirstName: "Eva",
        guardianEmail: "  ",
      },
      {
        ...CANDIDATE,
        requestChildId: "47",
        childFirstName: "Jona",
        acceptanceIssue: "acceptance_missing",
        renewal: true,
      },
    ]);
    renderPage();
    await screen.findAllByText("Lina Muster");
    fireEvent.click(screen.getByRole("button", { name: /Verträge erstellen/ }));
    expect(await screen.findByLabelText("Mia Kern auswählen")).toBeDisabled();
    expect(screen.getByLabelText("Ben Kern auswählen")).toBeDisabled();
    expect(screen.getByLabelText("Ole Kern auswählen")).toBeDisabled();
    expect(screen.getByLabelText("Eva Kern auswählen")).toBeDisabled();
    expect(screen.getByLabelText("Jona Kern auswählen")).toBeDisabled();
    // A renewal names the missing acceptance of the new phase (#6456).
    expect(
      screen.getByText("Zustimmung zur neuen Phase fehlt"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Die Eltern haben den Bedingungen für den neuen Zeitraum nicht zugestimmt, bevor die Schule angenommen hat\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("E-Mail-Adresse der Eltern fehlt"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Die Schule ergänzt die E-Mail-Adresse in der Anmeldung/,
      ),
    ).toBeInTheDocument();

    // Only the child with the proof comes about by itself.
    expect(
      screen.getAllByText(
        "Der Vertrag entsteht in wenigen Minuten von selbst.",
      ),
    ).toHaveLength(1);
    // Consent that does not match the current terms names what is known and the next step.
    expect(
      screen.getByText("Zustimmung passt nicht zum Vertrag"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Die Eltern haben anderen Bedingungen zugestimmt als den aktuellen\. Es entsteht kein Vertrag\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Zustimmung zum Vertrag fehlt"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /Zum Senden stellst du die Schule auf „Später verschicken“\./,
      ),
    ).toHaveLength(3);
    expect(
      screen.getByText(/sind hier keine Entwürfe nötig/),
    ).toBeInTheDocument();
  });

  it("names the children whose contract waits for a freed mail address and how the school frees it", async () => {
    api.fetchConclusionModes.mockResolvedValue([
      { schoolId: "3", schoolName: "OGS Am Lindenhof", mode: "bei_annahme" },
    ]);
    api.fetchContractCandidates.mockResolvedValue([
      CANDIDATE,
      {
        ...CANDIDATE,
        requestChildId: "47",
        childFirstName: "Jona",
        mailBlock: "address",
      },
      {
        ...CANDIDATE,
        requestChildId: "48",
        childFirstName: "Lea",
        mailBlock: "stopped",
      },
    ]);
    renderPage();
    await screen.findAllByText("Lina Muster");
    fireEvent.click(screen.getByRole("button", { name: /Verträge erstellen/ }));
    expect(await screen.findByLabelText("Jona Kern auswählen")).toBeDisabled();

    // Only the child whose mail goes out is promised a contract in minutes.
    expect(
      screen.getAllByText(
        "Der Vertrag entsteht in wenigen Minuten von selbst.",
      ),
    ).toHaveLength(1);
    expect(screen.getByText("Mail-Adresse gesperrt")).toBeInTheDocument();
    expect(screen.getByText("Mails gestoppt")).toBeInTheDocument();
    // A failed address is freed at the child; the application's address
    // cannot be changed.
    expect(
      screen.getByText(
        "Der Vertrag für Jona Kern kommt erst, wenn die Schule die Sperre der Mail-Adresse aufhebt. Mails an diese Adresse kamen nicht an. Die Schule prüft die Adresse beim Kind unter „Erziehungsberechtigte“ und wählt „Sperre aufheben“.",
      ),
    ).toBeInTheDocument();
    // A stop is the school's own choice, not a wrong address.
    expect(
      screen.getByText(
        "Der Vertrag für Lea Kern kommt erst, wenn die Schule wieder Mails an die Eltern sendet. Die Schule hat die Mails gestoppt. Sie wählt beim Kind unter „Erziehungsberechtigte“ „Mails wieder senden“.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/in der Anmeldung korrigiert/),
    ).not.toBeInTheDocument();
  });

  it("keeps the held mail out of a school that sends later", async () => {
    api.fetchConclusionModes.mockResolvedValue([
      { schoolId: "3", schoolName: "OGS Am Lindenhof", mode: "nachtraeglich" },
    ]);
    api.fetchContractCandidates.mockResolvedValue([
      { ...CANDIDATE, mailBlock: "address" },
    ]);
    renderPage();
    await screen.findAllByText("Lina Muster");
    fireEvent.click(screen.getByRole("button", { name: /Verträge erstellen/ }));
    expect(await screen.findByLabelText("Mia Kern auswählen")).toBeEnabled();
    expect(screen.getByText("Mia Kern")).toBeInTheDocument();
    expect(screen.queryByText("Mail-Adresse gesperrt")).not.toBeInTheDocument();
  });

  it("names an active contract with the day it was concluded", async () => {
    api.fetchCareContracts.mockResolvedValue({
      contracts: [
        {
          ...SENT,
          id: "9",
          status: "aktiv",
          childFirstName: "Ole",
          concluded: { method: "mit_anmeldung", at: "2026-09-03T08:00:00Z" },
        },
      ],
      counts: { aktiv: 1 },
      hasMore: false,
    });
    renderPage();

    expect((await screen.findAllByText("Aktiv"))[0]).toBeInTheDocument();
    expect(screen.getByText("seit 03.09.2026")).toBeInTheDocument();
    expect(screen.getByText("aktiv")).toBeInTheDocument();
  });
  // #6652: after a confirmed send a failed reload is a load error above the
  // list, not a failed send or a page error that replaces the contracts.
  describe("reload after a write (#6652)", () => {
    it("preserves sort focus while a confirmed metadata refresh shows a warning", async () => {
      api.createCareContracts.mockResolvedValueOnce({
        created: [DRAFT],
        skipped: [],
      });
      renderPage();
      await screen.findAllByText("Lina Muster");
      fireEvent.click(screen.getByRole("button", { name: "Alle Status" }));
      fireEvent.click(await screen.findByRole("option", { name: /^Entwurf/ }));
      await screen.findAllByText("Lina Muster");
      fireEvent.click(
        screen.getByRole("button", { name: /Verträge erstellen/ }),
      );
      api.fetchContractCandidates.mockRejectedValue(new ApiError("down", 503));
      fireEvent.click(
        await screen.findByRole("button", { name: "1 Entwurf erstellen" }),
      );
      expect(
        await screen.findByText(
          catalogText("general.unavailable", "die Liste der Verträge"),
        ),
      ).toBeVisible();
      const sorted = deferred<CareContractList>();
      api.fetchCareContracts.mockReturnValueOnce(sorted.promise);
      const child = screen.getByRole("button", {
        name: "Kind – Spalte sortieren",
      });
      child.focus();
      fireEvent.click(child);
      expect(child).toHaveFocus();
      await act(async () =>
        sorted.resolve({
          contracts: [DRAFT],
          counts: { entwurf: 1 },
          hasMore: false,
          revision: "v1:0:11",
        }),
      );
      expect((await screen.findAllByText("Lina Muster"))[0]).toBeVisible();
      expect(child).toHaveFocus();
    });

    it("retries a failed list reload after a send error without resending", async () => {
      api.sendCareContracts.mockRejectedValueOnce(
        new ApiError("send unavailable", 503),
      );
      renderPage();
      await screen.findAllByText("Lina Muster");
      api.fetchCareContracts
        .mockRejectedValueOnce(new ApiError("read unavailable", 503))
        .mockResolvedValueOnce({
          contracts: [SENT],
          counts: { versendet: 1 },
          hasMore: false,
        });
      fireEvent.click(
        screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
      );
      fireEvent.click(screen.getByRole("button", { name: "1 Entwurf senden" }));
      const retry = await screen.findByRole("button", { name: "Wiederholen" });
      expect(
        screen.getByText(
          catalogText("general.unavailable", "die Liste der Verträge"),
        ),
      ).toBeVisible();
      expect(screen.getAllByText("Lina Muster")[0]).toBeVisible();
      fireEvent.click(retry);
      await waitFor(() => expect(retry).not.toBeInTheDocument());
      expect(api.sendCareContracts).toHaveBeenCalledOnce();
      expect(api.fetchCareContracts).toHaveBeenCalledTimes(3);
    });

    it("reports a refused refresh directly even before the new sort shows contracts", async () => {
      const send = deferred<{ sent: string[]; skipped: [] }>();
      const sorted = deferred<CareContractList>();
      api.sendCareContracts.mockReturnValueOnce(send.promise);
      renderPage();
      await screen.findAllByText("Lina Muster");
      fireEvent.click(
        screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
      );
      fireEvent.click(screen.getByRole("button", { name: "1 Entwurf senden" }));
      api.fetchCareContracts
        .mockReturnValueOnce(sorted.promise)
        .mockRejectedValue(new ApiError("refused", 403));
      sortByChild();
      await waitFor(() =>
        expect(api.fetchCareContracts).toHaveBeenCalledTimes(2),
      );
      resetPageReloads();
      await act(async () => send.resolve({ sent: [DRAFT.id], skipped: [] }));
      await expectPageReloadedAfterRefusal();
    });

    it("removes the warning for a failed refresh when the next sort loads", async () => {
      api.sendCareContracts.mockResolvedValue({
        sent: [DRAFT.id],
        skipped: [],
      });
      renderPage();
      await screen.findAllByText("Lina Muster");
      api.fetchCareContracts.mockRejectedValueOnce(new ApiError("down", 503));
      fireEvent.click(
        screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
      );
      fireEvent.click(screen.getByRole("button", { name: "1 Entwurf senden" }));
      const warning = await screen.findByText(SAVED_BUT_STALE_SUFFIX, {
        exact: false,
      });
      const child = screen.getByRole("button", {
        name: "Kind – Spalte sortieren",
      });
      child.focus();
      const sorted = deferred<CareContractList>();
      api.fetchCareContracts.mockReturnValueOnce(sorted.promise);
      fireEvent.click(child);
      expect(child).toHaveFocus();
      await act(async () =>
        sorted.resolve({
          contracts: [SENT],
          counts: { versendet: 1 },
          hasMore: false,
          revision: "2",
        }),
      );
      // Anker: Die neue Sortierung zeigt ihre eigenen Verträge.
      expect((await screen.findAllByText("Ben Muster"))[0]).toBeVisible();
      expect(warning).not.toBeInTheDocument();
    });

    it("does not let an older replacement first page overtake the reload after sending", async () => {
      const initial = {
        contracts: [DRAFT],
        counts: { entwurf: 2 },
        hasMore: true,
        revision: "1",
      };
      const more = deferred<CareContractList>();
      const reload = deferred<CareContractList>();
      api.fetchCareContracts
        .mockResolvedValueOnce(initial)
        .mockReturnValueOnce(more.promise)
        .mockReturnValueOnce(reload.promise);
      api.sendCareContracts.mockResolvedValue({
        sent: [DRAFT.id],
        skipped: [],
      });
      renderPage();
      await screen.findAllByText("Lina Muster");
      fireEvent.click(
        screen.getByRole("button", { name: /^Weitere Verträge laden/ }),
      );
      fireEvent.click(
        screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
      );
      fireEvent.click(screen.getByRole("button", { name: "1 Entwurf senden" }));
      await waitFor(() =>
        expect(api.fetchCareContracts).toHaveBeenCalledTimes(3),
      );
      await act(async () => more.resolve({ ...initial, revision: "2" }));
      await act(async () =>
        reload.resolve({
          ...initial,
          contracts: [{ ...DRAFT, status: "versendet" }],
          counts: { versendet: 1 },
          hasMore: false,
          revision: "3",
        }),
      );
      const row = screen.getByRole("row", { name: /Lina Muster/ });
      expect(within(row).getByText("Versendet")).toBeVisible();
    });

    it("does not show a stale-data warning when a new sort overtakes the reload", async () => {
      const reload = deferred<CareContractList>();
      api.sendCareContracts.mockResolvedValue({
        sent: [DRAFT.id],
        skipped: [],
      });
      renderPage();
      await screen.findAllByText("Lina Muster");
      api.fetchCareContracts
        .mockReturnValueOnce(reload.promise)
        .mockResolvedValueOnce({
          contracts: [SENT],
          counts: { versendet: 1 },
          hasMore: false,
          revision: "2",
        });
      fireEvent.click(
        screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
      );
      fireEvent.click(screen.getByRole("button", { name: "1 Entwurf senden" }));
      await waitFor(() =>
        expect(api.fetchCareContracts).toHaveBeenCalledTimes(2),
      );
      sortByChild();
      await act(async () =>
        reload.resolve({
          contracts: [DRAFT],
          counts: { entwurf: 1 },
          hasMore: false,
          revision: "1",
        }),
      );
      // Anker: Die neue Sortierung hat ihre eigenen Daten geladen.
      expect((await screen.findAllByText("Ben Muster"))[0]).toBeVisible();
      expect(
        screen.queryByText(SAVED_BUT_STALE_SUFFIX, { exact: false }),
      ).not.toBeInTheDocument();
    });

    it.each([401, 403])(
      "loads the page anew after the reload refuses access (%s)",
      async (status) => {
        renderPage();
        await screen.findAllByText("Lina Muster");
        fireEvent.click(
          screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
        );
        fireEvent.click(
          screen.getByRole("button", { name: /Verträge erstellen/ }),
        );
        expect(await screen.findByRole("dialog")).toBeVisible();
        api.sendCareContracts.mockResolvedValue({ sent: ["7"], skipped: [] });
        resetPageReloads();
        api.fetchCareContracts.mockRejectedValueOnce(
          new ApiError("refused", status),
        );
        fireEvent.click(
          screen.getByRole("button", { name: "1 Entwurf senden" }),
        );
        // #6801: the page loads anew; its first load shows the refusal.
        await expectPageReloadedAfterRefusal();
        expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
      },
    );

    it("shows a reload failure after sending while a new filter has no data yet", async () => {
      const send = deferred<{ sent: string[]; skipped: [] }>();
      const filtered = deferred<{
        contracts: CareContractSummary[];
        counts: {};
        hasMore: boolean;
      }>();
      api.sendCareContracts.mockReturnValueOnce(send.promise);
      renderPage();
      await screen.findAllByText("Lina Muster");
      fireEvent.click(
        screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "1 Entwurf senden" }),
      );
      api.fetchCareContracts
        .mockReturnValueOnce(filtered.promise)
        .mockRejectedValueOnce(new ApiError("down", 503))
        .mockResolvedValue({
          contracts: [SENT],
          counts: { versendet: 1 },
          hasMore: false,
        });
      fireEvent.click(screen.getByRole("button", { name: "Alle Status" }));
      fireEvent.click(
        await screen.findByRole("option", { name: /^Versendet/ }),
      );
      await waitFor(() =>
        expect(api.fetchCareContracts).toHaveBeenCalledTimes(2),
      );
      await act(async () => send.resolve({ sent: ["7"], skipped: [] }));
      const retry = await screen.findByRole("button", { name: "Wiederholen" });
      expect(screen.getByRole("alert")).toHaveTextContent(
        SAVED_BUT_STALE_SUFFIX,
      );
      await act(async () =>
        filtered.resolve({ contracts: [DRAFT], counts: {}, hasMore: false }),
      );
      fireEvent.click(retry);
      expect((await screen.findAllByText("Ben Muster"))[0]).toBeVisible();
      expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
    });

    it("keeps created drafts created when the reload fails", async () => {
      api.createCareContracts.mockResolvedValue({
        created: [DRAFT],
        skipped: [],
      });
      renderPage();
      await screen.findAllByText("Lina Muster");
      fireEvent.click(screen.getByRole("button", { name: "Alle Status" }));
      fireEvent.click(await screen.findByRole("option", { name: /^Entwurf/ }));
      await waitFor(() =>
        expect(api.fetchCareContracts).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "entwurf" }),
        ),
      );
      await screen.findAllByText("Lina Muster");
      fireEvent.click(
        screen.getByRole("button", { name: /Verträge erstellen/ }),
      );
      const createButton = await screen.findByRole("button", {
        name: "1 Entwurf erstellen",
      });
      api.fetchCareContracts.mockClear();
      api.fetchCareContracts
        .mockRejectedValueOnce(
          new ApiError("down", 503, { code: "general.unavailable" }),
        )
        .mockResolvedValue({
          contracts: [DRAFT, SENT],
          counts: { entwurf: 1, versendet: 1 },
          hasMore: false,
        });

      fireEvent.click(createButton);

      const reloadText = `${catalogText(
        "general.unavailable",
        "die Anzeige der Verträge",
      )} ${SAVED_BUT_STALE_SUFFIX}`;
      expect(await screen.findByText(reloadText)).toBeInTheDocument();
      expect(api.createCareContracts).toHaveBeenCalledTimes(1);
      // Anker: the confirmed rows stay listed.
      expect(screen.getAllByText("Lina Muster")[0]).toBeInTheDocument();
      expect(
        screen.queryByText(catalogText("general.unavailable", "die Verträge")),
      ).not.toBeInTheDocument();
    });

    it("keeps sent drafts sent when the reload fails", async () => {
      api.sendCareContracts.mockResolvedValue({ sent: ["7"], skipped: [] });
      renderPage();
      await screen.findAllByText("Lina Muster");
      fireEvent.click(
        screen.getAllByLabelText("Vertrag von Lina Muster auswählen")[0]!,
      );
      const sendButton = await screen.findByRole("button", {
        name: "1 Entwurf senden",
      });
      api.fetchCareContracts.mockClear();
      api.fetchCareContracts
        .mockRejectedValueOnce(
          new ApiError("down", 503, { code: "general.unavailable" }),
        )
        .mockResolvedValue({
          contracts: [{ ...DRAFT, status: "versendet" }, SENT],
          counts: { versendet: 2 },
          hasMore: false,
        });

      fireEvent.click(sendButton);

      const reloadText = `${catalogText(
        "general.unavailable",
        "die Anzeige der Verträge",
      )} ${SAVED_BUT_STALE_SUFFIX}`;
      expect(await screen.findByText(reloadText)).toBeInTheDocument();
      expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
      // Anker: the confirmed rows stay listed.
      expect(screen.getAllByText("Lina Muster")[0]).toBeInTheDocument();
      expect(screen.getAllByText("Ben Muster")[0]).toBeInTheDocument();
      expect(
        screen.queryByText(catalogText("general.unavailable", "die Verträge")),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
      await waitFor(() =>
        expect(api.fetchCareContracts).toHaveBeenCalledTimes(2),
      );
      await waitFor(() =>
        expect(screen.queryByText(reloadText)).not.toBeInTheDocument(),
      );
      expect(screen.getAllByText("Lina Muster")[0]).toBeInTheDocument();
      expect(api.sendCareContracts).toHaveBeenCalledTimes(1);
    });
  });
});
