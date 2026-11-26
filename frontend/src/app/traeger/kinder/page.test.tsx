import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { Activity, useSyncExternalStore, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { berlinTodayISO } from "~/lib/date-helpers";
import { bumpScopeGeneration } from "~/lib/swr/generation";
import type {
  TraegerChild,
  TraegerChildrenPage,
} from "~/lib/traeger-children-api";
import { catalogText } from "~/test/error-catalog-text";
import { releaseFakeTimers, setTestClock } from "~/test/clock";
import { deferred } from "~/test/helpers/form-modal-pending";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";

const { api, navigation, rowDraws } = vi.hoisted(() => ({
  api: {
    fetchTraegerChildren: vi.fn(),
    downloadTraegerChildren: vi.fn(),
    fetchTraegerSchools: vi.fn(),
  },
  navigation: { replace: vi.fn(), query: "" },
  // Counts how often a row of the list is drawn: each draw names its class.
  rowDraws: vi.fn(),
}));

vi.unmock("swr");
vi.mock("~/lib/traeger-children-api", () => ({
  fetchTraegerChildren: api.fetchTraegerChildren,
  downloadTraegerChildren: api.downloadTraegerChildren,
}));
vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerSchools: api.fetchTraegerSchools,
}));
vi.mock("~/lib/school-class-label", async (original) => {
  const actual = await original<typeof import("~/lib/school-class-label")>();
  return {
    ...actual,
    schoolClassName: (schoolClass: string) => {
      rowDraws(schoolClass);
      return actual.schoolClassName(schoolClass);
    },
  };
});
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
function changeQuery(query: string) {
  navigation.query = query;
  window.dispatchEvent(new Event("test-navigation"));
}

function subscribeToQuery(listener: () => void) {
  window.addEventListener("test-navigation", listener);
  return () => window.removeEventListener("test-navigation", listener);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
  usePathname: () => "/kinder",
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(subscribeToQuery, () => navigation.query),
    ),
}));

import ChildrenPage from "./page-content";

const BACH = { id: "3", name: "OGS Am Bach" };
const LINDE = { id: "4", name: "OGS Zur Linde" };

const child = (
  studentId: string,
  lastName: string,
  firstName: string,
  school: typeof BACH,
  schoolClass: string,
  groupName: string,
): TraegerChild => ({
  studentId,
  schoolId: school.id,
  schoolName: school.name,
  firstName,
  lastName,
  schoolClass,
  groupName,
});

const AKSOY = child("11", "Aksoy", "Ömer", BACH, "1a", "");
const BERG = child("12", "Berg", "Anna", LINDE, "3c", "Füchse");
const ZANDER = child("13", "Zander", "Mia", BACH, "2b", "Eulen");

const SCHOOLS = [
  { ...BACH, children: 2 },
  { ...LINDE, children: 1 },
];

const pageOf = (
  children: readonly TraegerChild[],
  rest: Partial<TraegerChildrenPage> = {},
): TraegerChildrenPage => ({
  rosterDate: berlinTodayISO(),
  schools: SCHOOLS,
  total: children.length,
  matched: children.length,
  children,
  nextCursor: "",
  ...rest,
});

/** The reiter of a school; its name ends with the number of its children. */
const schoolTab = (school: typeof BACH) =>
  screen.getByRole("tab", { name: new RegExp(`^${school.name}`) });

function downloadOption() {
  const [menu] = screen.getAllByRole("button", { name: "Weitere Aktionen" });
  fireEvent.click(menu!);
  return screen.getByRole("menuitem", { name: /CSV/ });
}

function renderPage() {
  render(
    <TraegerResourceTestProvider>
      <ChildrenPage />
    </TraegerResourceTestProvider>,
  );
}

describe("TraegerChildrenPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    navigation.replace.mockReset().mockImplementation((url: string) => {
      changeQuery(url.slice(1));
    });
    rowDraws.mockClear();
    navigation.query = "";
    api.fetchTraegerSchools.mockResolvedValue([BACH, LINDE]);
    api.downloadTraegerChildren.mockResolvedValue({
      blob: new Blob(),
      filename: "kinder.csv",
    });
    api.fetchTraegerChildren.mockImplementation(
      ({ schoolId }: { schoolId: string }) =>
        Promise.resolve(
          schoolId === LINDE.id
            ? pageOf([BERG])
            : pageOf([AKSOY, BERG, ZANDER]),
        ),
    );
  });

  it("lists the children of every school with school, class and group", async () => {
    renderPage();

    expect((await screen.findAllByText("Zander, Mia")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Aksoy, Ömer").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("columnheader", { name: "Schule" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Eulen").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2b").length).toBeGreaterThan(0);
    // One reiter per school and one for all of them.
    expect(screen.getByRole("tab", { name: "Alle" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Each school's reiter carries the number of children it counts.
    expect(schoolTab(BACH)).toHaveTextContent(/2$/);
    expect(schoolTab(LINDE)).toHaveTextContent(/1$/);
    expect(api.fetchTraegerChildren).toHaveBeenCalledWith({
      schoolId: "",
      search: "",
    });
  });

  it("opens one school in its reiter and keeps it in the address", async () => {
    renderPage();
    await screen.findAllByText("Zander, Mia");

    fireEvent.click(schoolTab(LINDE));

    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledWith({
        schoolId: LINDE.id,
        search: "",
      }),
    );
    expect((await screen.findAllByText("Berg, Anna")).length).toBeGreaterThan(
      0,
    );
    // Anchor: the list of the school stands, so its rows replaced the others.
    await waitFor(() =>
      expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument(),
    );
    // The school is the reiter; its column would repeat it on every row.
    expect(
      screen.queryByRole("columnheader", { name: "Schule" }),
    ).not.toBeInTheDocument();
    expect(navigation.replace).toHaveBeenCalledWith("?schule=4", {
      scroll: false,
    });
  });

  it("opens the reiter of the school the address names", async () => {
    navigation.query = "schule=4";
    renderPage();

    expect((await screen.findAllByText("Berg, Anna")).length).toBeGreaterThan(
      0,
    );
    expect(schoolTab(LINDE)).toHaveAttribute("aria-selected", "true");
    expect(api.fetchTraegerChildren).toHaveBeenCalledWith({
      schoolId: LINDE.id,
      search: "",
    });
  });

  it("validates new school tabs with the same schools the audited read returned", async () => {
    api.fetchTraegerSchools.mockResolvedValue([BACH]);
    renderPage();
    await screen.findAllByText("Zander, Mia");

    fireEvent.click(schoolTab(LINDE));
    await waitFor(() =>
      expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument(),
    );
    await screen.findAllByText("Berg, Anna");
    fireEvent.click(downloadOption());
    expect(api.downloadTraegerChildren).toHaveBeenCalledWith(
      "csv",
      { schoolId: LINDE.id, search: "" },
      berlinTodayISO(),
    );
  });

  it("switches to all schools when navigation removes the school parameter", async () => {
    navigation.query = "schule=4";
    renderPage();
    await screen.findAllByText("Berg, Anna");
    expect(schoolTab(LINDE)).toHaveAttribute("aria-selected", "true");

    act(() => changeQuery(""));

    await screen.findAllByText("Zander, Mia");
    expect(screen.getByRole("tab", { name: "Alle" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps a bookmarked school scoped even when shared school metadata is stale", async () => {
    navigation.query = "schule=4";
    api.fetchTraegerSchools.mockResolvedValue([BACH]);
    renderPage();

    await screen.findAllByText("Berg, Anna");
    expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
    expect(api.fetchTraegerChildren).toHaveBeenCalledExactlyOnceWith({
      schoolId: LINDE.id,
      search: "",
    });
    fireEvent.click(downloadOption());
    expect(api.downloadTraegerChildren).toHaveBeenCalledWith(
      "csv",
      { schoolId: LINDE.id, search: "" },
      berlinTodayISO(),
    );
  });

  it("offers an explicit switch to all schools after a removed-school bookmark is refused", async () => {
    navigation.query = "schule=4";
    api.fetchTraegerSchools.mockResolvedValue([BACH]);
    api.fetchTraegerChildren.mockImplementation(
      ({ schoolId }: { schoolId: string }) =>
        schoolId
          ? Promise.reject(
              new ApiError("not found", 404, {
                code: "traeger.school_not_found",
              }),
            )
          : Promise.resolve(
              pageOf([ZANDER], { schools: [{ ...BACH, children: 1 }] }),
            ),
    );
    renderPage();
    const showAll = await screen.findByRole("button", {
      name: "Alle Schulen anzeigen",
    });
    expect(api.fetchTraegerChildren).toHaveBeenCalledExactlyOnceWith({
      schoolId: LINDE.id,
      search: "",
    });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(downloadOption()).toBeDisabled();

    fireEvent.click(showAll);
    await screen.findAllByText("Zander, Mia");
    expect(navigation.query).toBe("");
    expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
      schoolId: "",
      search: "",
    });
  });

  it("offers a reset for a malformed bookmark without reading any school", async () => {
    navigation.query = "schule=0";
    api.fetchTraegerSchools.mockResolvedValue([BACH]);
    renderPage();

    expect(downloadOption()).toBeDisabled();
    expect(api.fetchTraegerChildren).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Alle Schulen anzeigen" }),
    );
    await screen.findAllByText("Zander, Mia");
    expect(api.fetchTraegerChildren).toHaveBeenCalledExactlyOnceWith({
      schoolId: "",
      search: "",
    });
  });

  it("keeps an overlong search at the field and accepts a trimmed 100-code-point search", async () => {
    renderPage();
    await screen.findAllByText("Zander, Mia");
    const [field] = screen.getAllByPlaceholderText("Kind suchen");
    const allowed = "𐐷".repeat(100);
    vi.useFakeTimers();
    try {
      fireEvent.change(field!, { target: { value: allowed + "x" } });
      expect(field).toHaveAccessibleDescription(
        "Kürze deine Suche auf höchstens 100 Zeichen.",
      );
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(1);
      expect(downloadOption()).toBeDisabled();

      fireEvent.change(field!, { target: { value: " " + allowed + " " } });
      expect(field).not.toHaveAttribute("aria-invalid", "true");
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
        schoolId: "",
        search: allowed,
      });
    } finally {
      releaseFakeTimers();
    }
  });

  it("only enables downloads after the visible search finishes loading", async () => {
    renderPage();
    await screen.findAllByText("Zander, Mia");
    const [field] = screen.getAllByPlaceholderText("Kind suchen");
    const searchResult = deferred<TraegerChildrenPage>();
    api.fetchTraegerChildren.mockReturnValue(searchResult.promise);

    vi.useFakeTimers();
    try {
      fireEvent.change(field!, { target: { value: "Berg" } });
      const csv = downloadOption();
      expect(csv).toBeDisabled();
      fireEvent.click(csv);
      expect(api.downloadTraegerChildren).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
        schoolId: "",
        search: "Berg",
      });
      expect(screen.getByRole("menuitem", { name: /CSV/ })).toBeDisabled();
    } finally {
      releaseFakeTimers();
    }

    await act(async () => {
      searchResult.resolve(pageOf([BERG]));
      await searchResult.promise;
    });
    const csv = screen.getByRole("menuitem", { name: /CSV/ });
    expect(csv).toBeEnabled();
    fireEvent.click(csv);
    expect(api.downloadTraegerChildren).toHaveBeenCalledWith(
      "csv",
      { schoolId: "", search: "Berg" },
      berlinTodayISO(),
    );
  });

  it("waits for a fresh audited read when React restores the page", async () => {
    const view = (mode: "visible" | "hidden") => (
      <TraegerResourceTestProvider>
        <Activity mode={mode}>
          <ChildrenPage />
        </Activity>
      </TraegerResourceTestProvider>
    );
    const { rerender } = render(view("visible"));
    await screen.findAllByText("Zander, Mia");
    const opening = deferred<TraegerChildrenPage>();
    api.fetchTraegerChildren.mockReturnValue(opening.promise);

    rerender(view("hidden"));
    rerender(view("visible"));

    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
    await act(async () => {
      opening.reject(new ApiError("refused", 403));
      await opening.promise.catch(() => undefined);
    });
    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Kinder"),
      ),
    ).toBeVisible();
  });

  it("keeps the fresh list when a pre-hide read is refused after React restores the page", async () => {
    const old = deferred<TraegerChildrenPage>();
    api.fetchTraegerChildren
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(pageOf([BERG]));
    const view = (mode: "visible" | "hidden") => (
      <TraegerResourceTestProvider>
        <Activity mode={mode}>
          <ChildrenPage />
        </Activity>
      </TraegerResourceTestProvider>
    );
    const { rerender } = render(view("visible"));
    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(1),
    );
    rerender(view("hidden"));
    rerender(view("visible"));
    await screen.findAllByText("Berg, Anna");

    await act(async () => {
      old.reject(new ApiError("refused", 403));
      await old.promise.catch(() => undefined);
    });

    expect(screen.getByText("Berg, Anna")).toBeVisible();
  });

  it("withdraws a school's shown names when its download is refused", async () => {
    navigation.query = "schule=4";
    api.downloadTraegerChildren.mockRejectedValue(
      new ApiError("not found", 404),
    );
    renderPage();
    await screen.findAllByText("Berg, Anna");
    api.fetchTraegerChildren.mockRejectedValue(new ApiError("not found", 404));

    fireEvent.click(downloadOption());

    await waitFor(() =>
      expect(screen.queryByText("Berg, Anna")).not.toBeInTheDocument(),
    );
    expect(downloadOption()).toBeDisabled();
  });

  it("discards an older answer for the same filter after a download refusal", async () => {
    const old = deferred<TraegerChildrenPage>();
    const fresh = deferred<TraegerChildrenPage>();
    api.fetchTraegerChildren
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(pageOf([BERG]))
      .mockResolvedValueOnce(pageOf([ZANDER]))
      .mockReturnValueOnce(fresh.promise);
    api.downloadTraegerChildren.mockRejectedValue(new ApiError("refused", 403));
    renderPage();
    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(schoolTab(LINDE));
    await screen.findAllByText("Berg, Anna");
    fireEvent.click(screen.getByRole("tab", { name: "Alle" }));
    await screen.findAllByText("Zander, Mia");
    fireEvent.click(downloadOption());

    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(4),
    );
    await act(async () => {
      old.resolve(pageOf([AKSOY]));
      await old.promise;
    });
    expect(screen.queryByText("Aksoy, Ömer")).not.toBeInTheDocument();
    expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
    expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(4);

    await act(async () => {
      fresh.resolve(pageOf([BERG]));
      await fresh.promise;
    });
    expect(screen.getByText("Berg, Anna")).toBeVisible();
  });

  it("logs neither the searched name nor the cursor when the BFF returns an error", async () => {
    const realApi = await vi.importActual<
      typeof import("~/lib/traeger-children-api")
    >("~/lib/traeger-children-api");
    const search = "VertraulicherSuchname";
    const cursor = btoa(
      JSON.stringify({ first: "Testkind", last: "Cursorname" }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response("{}", {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderPage();
      await screen.findAllByText("Zander, Mia");
      api.fetchTraegerChildren.mockResolvedValueOnce(
        pageOf([BERG], { matched: 2, nextCursor: cursor }),
      );
      fireEvent.change(screen.getAllByPlaceholderText("Kind suchen")[0]!, {
        target: { value: search },
      });
      const more = await screen.findByRole("button", {
        name: /Weitere Kinder laden/,
      });
      api.fetchTraegerChildren.mockImplementationOnce(
        realApi.fetchTraegerChildren,
      );
      fireEvent.click(more);
      await screen.findByText(
        catalogText("general.server", "die nächsten Kinder"),
      );

      api.downloadTraegerChildren.mockImplementationOnce(
        realApi.downloadTraegerChildren,
      );
      fireEvent.click(downloadOption());
      await screen.findByText(
        catalogText("general.server", "die Liste der Kinder"),
      );

      const urls = fetchMock.mock.calls.map(
        ([input]) => new URL(String(input), "http://localhost").searchParams,
      );
      expect(urls[0]?.get("cursor")).toBe(cursor);
      expect(urls.map((query) => query.get("search"))).toEqual([
        search,
        search,
      ]);
      const logs = JSON.stringify(errors.mock.calls);
      expect(logs).toContain("traeger_children_load_more_failed");
      expect(logs).toContain("traeger_list_export_failed");
      expect(logs).not.toContain(search);
      expect(logs).not.toContain(cursor);
    } finally {
      errors.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("sends the displayed roster date and reads again when that date is refused", async () => {
    const rosterDate = "2026-11-26";
    setTestClock("2026-11-26T22:59:30Z");
    api.fetchTraegerChildren
      .mockResolvedValueOnce(pageOf([ZANDER], { rosterDate }))
      .mockResolvedValueOnce(pageOf([BERG], { rosterDate: "2026-11-27" }));
    api.downloadTraegerChildren.mockRejectedValue(
      new ApiError("changed", 409, {
        code: "general.changed_since_read",
      }),
    );
    renderPage();
    await screen.findAllByText("Zander, Mia");
    setTestClock("2026-11-26T23:00:00Z");
    fireEvent.click(downloadOption());

    expect(api.downloadTraegerChildren).toHaveBeenCalledExactlyOnceWith(
      "csv",
      { schoolId: "", search: "" },
      rosterDate,
    );
    await screen.findAllByText("Berg, Anna");
    expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
  });

  it("keeps an expired list withdrawn and offers a page retry after dismissing the toast", async () => {
    setTestClock("2026-11-26T22:59:30Z");
    const refresh = deferred<TraegerChildrenPage>();
    api.fetchTraegerChildren
      .mockResolvedValueOnce(pageOf([ZANDER]))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(pageOf([BERG], { rosterDate: "2026-11-27" }));
    api.downloadTraegerChildren.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    renderPage();
    await screen.findAllByText("Zander, Mia");
    fireEvent.click(downloadOption());
    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(2),
    );

    // Anker: the refresh is still pending while the rejected names are gone.
    expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
    await act(async () => refresh.reject(new ApiError("unavailable", 500)));
    const closeToast = await screen.findByRole("button", { name: "Schließen" });
    fireEvent.click(closeToast);
    await waitForElementToBeRemoved(closeToast);
    const retry = await screen.findByRole("button", { name: "Wiederholen" });
    expect(retry).toBeVisible();
    expect(
      screen.getByText(catalogText("general.server", "die Liste der Kinder")),
    ).toBeVisible();
    expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
    expect(downloadOption()).toBeDisabled();
    fireEvent.click(retry);
    await screen.findAllByText("Berg, Anna");
    expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
  });

  it("keeps another school's results if the previous school's export is refused late", async () => {
    navigation.query = "schule=4";
    const download = deferred<unknown>();
    api.downloadTraegerChildren.mockReturnValue(download.promise);
    renderPage();
    await screen.findAllByText("Berg, Anna");
    fireEvent.click(downloadOption());

    fireEvent.click(screen.getByRole("tab", { name: "Alle" }));
    await screen.findAllByText("Zander, Mia");
    await act(async () => {
      download.reject(
        new ApiError("not found", 404, { code: "traeger.school_not_found" }),
      );
      await download.promise.catch(() => undefined);
    });

    expect(
      await screen.findByText(/Download für „OGS Zur Linde“/),
    ).toBeVisible();
    expect(screen.getAllByText("Zander, Mia")[0]).toBeVisible();
    expect(downloadOption()).toBeEnabled();
  });

  it("keeps the current list when its download fails transiently", async () => {
    api.downloadTraegerChildren.mockRejectedValue(
      new ApiError("unavailable", 500),
    );
    renderPage();
    await screen.findAllByText("Zander, Mia");

    fireEvent.click(downloadOption());
    await screen.findByText(
      catalogText("general.server", "die Liste der Kinder"),
    );

    expect(screen.getAllByText("Zander, Mia")[0]).toBeVisible();
    expect(downloadOption()).toBeEnabled();
  });

  it("shows neither reiters nor the school column for a single school", async () => {
    api.fetchTraegerSchools.mockResolvedValue([BACH]);
    api.fetchTraegerChildren.mockResolvedValue(
      pageOf([AKSOY, ZANDER], { schools: [{ ...BACH, children: 2 }] }),
    );
    renderPage();

    expect((await screen.findAllByText("Zander, Mia")).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Schule" }),
    ).not.toBeInTheDocument();
  });

  it("searches on the server and offers the way back from an empty result", async () => {
    renderPage();
    await screen.findAllByText("Zander, Mia");
    api.fetchTraegerChildren.mockResolvedValue(
      pageOf([], { total: 3, matched: 0 }),
    );

    fireEvent.change(screen.getAllByPlaceholderText("Kind suchen")[0]!, {
      target: { value: "xyz" },
    });

    expect(await screen.findByText("Kein Kind gefunden")).toBeVisible();
    expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
      schoolId: "",
      search: "xyz",
    });

    api.fetchTraegerChildren.mockResolvedValue(pageOf([AKSOY, BERG, ZANDER]));
    fireEvent.click(
      screen.getByRole("button", { name: "Filter zurücksetzen" }),
    );

    expect((await screen.findAllByText("Zander, Mia")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByPlaceholderText("Kind suchen")[0]).toHaveValue("");
  });

  it("disables pagination on the first keystroke without redrawing on each letter", async () => {
    api.fetchTraegerChildren.mockResolvedValueOnce(
      pageOf([AKSOY, BERG, ZANDER], { matched: 4, nextCursor: "next-page" }),
    );
    renderPage();
    await screen.findAllByText("Zander, Mia");
    const field = screen.getAllByPlaceholderText("Kind suchen")[0]!;
    fireEvent.change(field, { target: { value: "z" } });
    const more = screen.getByRole("button", { name: /Weitere Kinder laden/ });
    expect(more).toBeDisabled();
    fireEvent.click(more);
    expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(1);
    const drawn = rowDraws.mock.calls.length;

    fireEvent.change(field, { target: { value: "za" } });

    // Anchor: the field shows what was typed.
    expect(field).toHaveValue("za");
    // A letter must not cost a redraw of every row: on a slow device that
    // is what delays the next letter (#8197 for the children search).
    expect(rowDraws.mock.calls.length).toBe(drawn);

    // Only the finished term is read, and so logged, once.
    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
        schoolId: "",
        search: "za",
      }),
    );
    expect(api.fetchTraegerChildren).not.toHaveBeenCalledWith({
      schoolId: "",
      search: "z",
    });
  });

  it("loads the next children below the list", async () => {
    api.fetchTraegerChildren.mockResolvedValueOnce(
      pageOf([AKSOY, BERG], { total: 3, matched: 3, nextCursor: "next-page" }),
    );
    renderPage();
    await screen.findAllByText("Berg, Anna");
    api.fetchTraegerChildren.mockResolvedValueOnce(
      pageOf([ZANDER], { total: 3, matched: 3 }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Kinder laden (2 von 3)" }),
    );

    expect((await screen.findAllByText("Zander, Mia")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Aksoy, Ömer").length).toBeGreaterThan(0);
    expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith(
      { schoolId: "", search: "" },
      "next-page",
    );
    expect(
      screen.queryByRole("button", { name: /Weitere Kinder laden/ }),
    ).not.toBeInTheDocument();
  });

  it("replaces a renamed child and updates all counts from the continuation", async () => {
    api.fetchTraegerChildren
      .mockResolvedValueOnce(
        pageOf([AKSOY, BERG], {
          total: 3,
          matched: 3,
          nextCursor: "second",
        }),
      )
      .mockResolvedValueOnce(
        pageOf([AKSOY, BERG], {
          total: 3,
          matched: 3,
          nextCursor: "filtered-second",
        }),
      )
      .mockResolvedValueOnce(
        pageOf([{ ...AKSOY, lastName: "Erler" }, ZANDER], {
          schools: [
            { ...BACH, children: 4 },
            { ...LINDE, children: 1 },
          ],
          total: 5,
          matched: 5,
          nextCursor: "third",
        }),
      );
    renderPage();
    await screen.findAllByText("Berg, Anna");
    fireEvent.change(screen.getAllByPlaceholderText("Kind suchen")[0]!, {
      target: { value: "er" },
    });
    await screen.findByText("gefunden");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Weitere Kinder laden (2 von 3)",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Weitere Kinder laden (3 von 5)",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Aksoy, Ömer")).not.toBeInTheDocument();
    expect(screen.getByText("Erler, Ömer")).toBeVisible();
    expect(schoolTab(BACH)).toHaveTextContent(/4$/);
    expect(
      screen.getByText("Kinder", { selector: "span" }).parentElement,
    ).toHaveTextContent(/5\s*Kinder/);
  });

  it("updates roster counts from an empty continuation without showing zero search hits", async () => {
    api.fetchTraegerChildren
      .mockResolvedValueOnce(pageOf([AKSOY, BERG, ZANDER]))
      .mockResolvedValueOnce(
        pageOf([BERG], { total: 3, matched: 2, nextCursor: "second" }),
      )
      .mockResolvedValueOnce(
        pageOf([], {
          total: 2,
          schools: [
            { ...BACH, children: 1 },
            { ...LINDE, children: 1 },
          ],
        }),
      );
    renderPage();
    await screen.findAllByText("Berg, Anna");
    fireEvent.change(screen.getAllByPlaceholderText("Kind suchen")[0]!, {
      target: { value: "er" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Weitere Kinder laden (1 von 2)",
      }),
    );

    await waitFor(() => expect(schoolTab(BACH)).toHaveTextContent(/1$/));
    expect(
      screen.getByText("Kinder", { selector: "span" }).parentElement,
    ).toHaveTextContent(/2\s*Kinder/);
    expect(screen.getByText("gefunden").parentElement).toHaveTextContent(
      /2\s*gefunden/,
    );
    expect(screen.getAllByText("Berg, Anna")[0]).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Weitere Kinder laden/ }),
    ).not.toBeInTheDocument();
  });

  it("reads the first page again when an empty continuation makes the search count impossible", async () => {
    api.fetchTraegerChildren
      .mockResolvedValueOnce(pageOf([BERG, ZANDER]))
      .mockResolvedValueOnce(
        pageOf([BERG], { total: 2, matched: 2, nextCursor: "second" }),
      )
      .mockResolvedValueOnce(pageOf([], { total: 1 }))
      .mockResolvedValueOnce(pageOf([BERG], { total: 1, matched: 1 }));
    renderPage();
    await screen.findAllByText("Zander, Mia");
    fireEvent.change(screen.getAllByPlaceholderText("Kind suchen")[0]!, {
      target: { value: "er" },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Weitere Kinder laden (1 von 2)",
      }),
    );

    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(4),
    );
    expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
      schoolId: "",
      search: "er",
    });
    await waitFor(() =>
      expect(screen.getByText("gefunden").parentElement).toHaveTextContent(
        /1\s*gefunden/,
      ),
    );
  });

  it("drops names and starts over when the continuation has fewer schools, even without rows", async () => {
    const fresh = deferred<TraegerChildrenPage>();
    const remainingSchools = [{ ...BACH, children: 1 }];
    api.fetchTraegerChildren
      .mockResolvedValueOnce(pageOf([AKSOY, BERG], { nextCursor: "old-scope" }))
      .mockResolvedValueOnce(pageOf([], { schools: remainingSchools }))
      .mockReturnValueOnce(fresh.promise);
    renderPage();
    await screen.findAllByText("Berg, Anna");
    fireEvent.click(
      screen.getByRole("button", { name: /Weitere Kinder laden/ }),
    );

    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(3),
    );
    expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
      schoolId: "",
      search: "",
    });
    expect(screen.queryByText("Berg, Anna")).not.toBeInTheDocument();
    expect(downloadOption()).toBeDisabled();
    await act(async () =>
      fresh.resolve(pageOf([ZANDER], { schools: remainingSchools })),
    );
    expect(screen.getByText("Zander, Mia")).toBeVisible();
  });

  it("starts over after the server refuses an expired cursor before the browser reaches midnight", async () => {
    setTestClock("2026-11-26T22:59:30Z");
    api.fetchTraegerChildren
      .mockResolvedValueOnce(pageOf([AKSOY], { nextCursor: "yesterday" }))
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockResolvedValueOnce(pageOf([BERG], { rosterDate: "2026-11-27" }));
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /Weitere Kinder laden/ }),
    );

    await screen.findAllByText("Berg, Anna");
    expect(screen.queryByText("Aksoy, Ömer")).not.toBeInTheDocument();
    expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(3);
    expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
      schoolId: "",
      search: "",
    });
  });

  it("loads the new day's first page when the first click after midnight precedes the date poll", async () => {
    setTestClock("2026-11-26T22:59:30Z");
    api.fetchTraegerChildren
      .mockResolvedValueOnce(
        pageOf([AKSOY], { matched: 2, nextCursor: "yesterday" }),
      )
      .mockResolvedValueOnce(pageOf([BERG], { rosterDate: "2026-11-27" }));
    renderPage();
    const more = await screen.findByRole("button", {
      name: /Weitere Kinder laden/,
    });

    setTestClock("2026-11-26T23:00:00Z");
    fireEvent.click(more);

    await screen.findAllByText("Berg, Anna");
    expect(screen.queryByText("Aksoy, Ömer")).not.toBeInTheDocument();
    expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(2);
    expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
      schoolId: "",
      search: "",
    });
  });

  it("opens a fresh roster after Berlin midnight and discards yesterday's continuation", async () => {
    setTestClock("2026-11-26T22:59:30Z");
    const continuation = deferred<TraegerChildrenPage>();
    const opening = deferred<TraegerChildrenPage>();
    api.fetchTraegerChildren
      .mockResolvedValueOnce(
        pageOf([AKSOY], { matched: 2, nextCursor: "yesterday" }),
      )
      .mockReturnValueOnce(continuation.promise)
      .mockReturnValueOnce(opening.promise);
    vi.useFakeTimers();
    try {
      renderPage();
      await act(async () => vi.advanceTimersByTimeAsync(0));
      fireEvent.click(
        screen.getByRole("button", { name: "Weitere Kinder laden (1 von 2)" }),
      );
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(3);
      expect(api.fetchTraegerChildren).toHaveBeenLastCalledWith({
        schoolId: "",
        search: "",
      });
      expect(screen.queryByText("Aksoy, Ömer")).not.toBeInTheDocument();
      expect(schoolTab(BACH)).not.toHaveTextContent(/2$/);
      await act(async () => {
        continuation.resolve(pageOf([ZANDER]));
        await continuation.promise;
        opening.resolve(pageOf([BERG]));
        await opening.promise;
      });
      expect(screen.getByText("Berg, Anna")).toBeVisible();
      expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
    } finally {
      releaseFakeTimers();
    }
  });

  it("never shows a first page from before midnight if its answer arrives after midnight", async () => {
    setTestClock("2026-11-26T22:59:30Z");
    const yesterday = pageOf([AKSOY]);
    const old = deferred<TraegerChildrenPage>();
    const fresh = deferred<TraegerChildrenPage>();
    api.fetchTraegerChildren
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    renderPage();
    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(1),
    );

    setTestClock("2026-11-26T23:00:00Z");
    await act(async () => old.resolve(yesterday));
    expect(api.fetchTraegerChildren).toHaveBeenCalledTimes(2);
    await act(async () => fresh.resolve(pageOf([BERG])));
    expect(screen.getByText("Berg, Anna")).toBeVisible();
    expect(screen.queryByText("Aksoy, Ömer")).not.toBeInTheDocument();
  });

  it("shows and exports the server's roster even when the device is a day ahead", async () => {
    setTestClock("2026-11-27T00:30:00+01:00");
    const rosterDate = "2026-11-26";
    api.fetchTraegerChildren.mockResolvedValue(
      pageOf([ZANDER], { rosterDate }),
    );
    renderPage();
    await screen.findAllByText("Zander, Mia");
    fireEvent.click(downloadOption());

    expect(api.downloadTraegerChildren).toHaveBeenCalledExactlyOnceWith(
      "csv",
      { schoolId: "", search: "" },
      rosterDate,
    );
  });

  it("shows no names of an earlier visit before the reiter's own read answers", async () => {
    renderPage();
    await screen.findAllByText("Zander, Mia");
    fireEvent.click(schoolTab(LINDE));
    await screen.findAllByText("Berg, Anna");
    // Every read is written to the schools' access logs: coming back to
    // „Alle“ waits for its own answer instead of showing the cached names.
    api.fetchTraegerChildren.mockImplementation(
      () => new Promise(() => undefined),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Alle" }));

    // Anchor: the reiter is open and its list is loading.
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Alle" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.queryByText("Zander, Mia")).not.toBeInTheDocument();
    expect(screen.queryByText("Berg, Anna")).not.toBeInTheDocument();
  });

  it("takes the shown names away when loading the next children is refused", async () => {
    api.fetchTraegerChildren.mockResolvedValueOnce(
      pageOf([AKSOY, BERG], { total: 3, matched: 3, nextCursor: "next-page" }),
    );
    renderPage();
    await screen.findAllByText("Berg, Anna");
    api.fetchTraegerChildren
      .mockRejectedValueOnce(new ApiError("refused", 403))
      .mockImplementation(() => new Promise(() => undefined));

    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Kinder laden (2 von 3)" }),
    );

    // Anchor: the refusal is shown, so the list is gone, not only hidden.
    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Kinder"),
      ),
    ).toBeVisible();
    expect(screen.queryByText("Berg, Anna")).not.toBeInTheDocument();
  });

  it("keeps the open reiter when another reiter's next children are refused late", async () => {
    const lateRefusal = deferred<TraegerChildrenPage>();
    const school = deferred<TraegerChildrenPage>();
    api.fetchTraegerChildren.mockImplementation(
      ({ schoolId }: { schoolId: string }, cursor?: string) => {
        if (cursor) return lateRefusal.promise;
        if (schoolId === LINDE.id) return school.promise;
        return Promise.resolve(
          pageOf([AKSOY, ZANDER], {
            total: 3,
            matched: 3,
            nextCursor: "next-page",
          }),
        );
      },
    );
    renderPage();
    await screen.findAllByText("Zander, Mia");
    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Kinder laden (2 von 3)" }),
    );
    fireEvent.click(schoolTab(LINDE));
    await waitFor(() =>
      expect(api.fetchTraegerChildren).toHaveBeenCalledWith({
        schoolId: LINDE.id,
        search: "",
      }),
    );

    // The refusal of „Alle“ arrives while the school's own list is on its
    // way: it must not take that read away.
    await act(async () => {
      lateRefusal.reject(new ApiError("refused", 403));
      await lateRefusal.promise.catch(() => undefined);
    });
    await act(async () => {
      school.resolve(pageOf([BERG]));
      await school.promise;
    });

    expect((await screen.findAllByText("Berg, Anna")).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByText(
        catalogText("general.permission", "die Liste der Kinder"),
      ),
    ).not.toBeInTheDocument();
  });

  it.each([403, 500])(
    "ignores a load-more error (%i) from a previous session generation",
    async (status) => {
      const late = deferred<TraegerChildrenPage>();
      api.fetchTraegerChildren
        .mockResolvedValueOnce(
          pageOf([AKSOY, BERG], { matched: 3, nextCursor: "next-page" }),
        )
        .mockReturnValueOnce(late.promise);
      renderPage();
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Weitere Kinder laden (2 von 3)",
        }),
      );

      act(() => bumpScopeGeneration());
      await screen.findAllByText("Zander, Mia");
      await act(async () => {
        late.reject(new ApiError("late failure", status));
        await late.promise.catch(() => undefined);
      });

      expect(screen.getAllByText("Zander, Mia")[0]).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("names the missing right instead of a list", async () => {
    api.fetchTraegerChildren.mockRejectedValue(new ApiError("refused", 403));
    renderPage();

    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Kinder"),
      ),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
