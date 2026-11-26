import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type {
  TraegerChild,
  TraegerChildrenPage,
} from "~/lib/traeger-children-api";
import { catalogText } from "~/test/error-catalog-text";
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
  usePathname: () => "/kinder",
  useSearchParams: () => new URLSearchParams(navigation.query),
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
  schools: SCHOOLS,
  total: children.length,
  matched: children.length,
  children,
  hasMore: false,
  ...rest,
});

/** The reiter of a school; its name ends with the number of its children. */
const schoolTab = (school: typeof BACH) =>
  screen.getByRole("tab", { name: new RegExp(`^${school.name}`) });

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
    navigation.replace.mockReset();
    rowDraws.mockClear();
    navigation.query = "";
    api.fetchTraegerSchools.mockResolvedValue([BACH, LINDE]);
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

  it("redraws only the search field while a name is typed", async () => {
    renderPage();
    await screen.findAllByText("Zander, Mia");
    const field = screen.getAllByPlaceholderText("Kind suchen")[0]!;
    const drawn = rowDraws.mock.calls.length;

    fireEvent.change(field, { target: { value: "z" } });
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
      pageOf([AKSOY, BERG], { total: 3, matched: 3, hasMore: true }),
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
      2,
    );
    expect(
      screen.queryByRole("button", { name: /Weitere Kinder laden/ }),
    ).not.toBeInTheDocument();
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
      pageOf([AKSOY, BERG], { total: 3, matched: 3, hasMore: true }),
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
      ({ schoolId }: { schoolId: string }, offset?: number) => {
        if (offset) return lateRefusal.promise;
        if (schoolId === LINDE.id) return school.promise;
        return Promise.resolve(
          pageOf([AKSOY, ZANDER], { total: 3, matched: 3, hasMore: true }),
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
