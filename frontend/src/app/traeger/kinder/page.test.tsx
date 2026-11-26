import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type {
  TraegerChild,
  TraegerChildrenPage,
} from "~/lib/traeger-children-api";
import { catalogText } from "~/test/error-catalog-text";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";

const { api, navigation } = vi.hoisted(() => ({
  api: {
    fetchTraegerChildren: vi.fn(),
    downloadTraegerChildren: vi.fn(),
    fetchTraegerSchools: vi.fn(),
  },
  navigation: { replace: vi.fn(), query: "" },
}));

vi.unmock("swr");
vi.mock("~/lib/traeger-children-api", () => ({
  fetchTraegerChildren: api.fetchTraegerChildren,
  downloadTraegerChildren: api.downloadTraegerChildren,
}));
vi.mock("~/lib/traeger-api", () => ({
  fetchTraegerSchools: api.fetchTraegerSchools,
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
    expect(screen.getByRole("tab", { name: BACH.name })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: LINDE.name })).toBeInTheDocument();
    expect(api.fetchTraegerChildren).toHaveBeenCalledWith({
      schoolId: "",
      search: "",
    });
  });

  it("opens one school in its reiter and keeps it in the address", async () => {
    renderPage();
    await screen.findAllByText("Zander, Mia");

    fireEvent.click(screen.getByRole("tab", { name: LINDE.name }));

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
    expect(screen.getByRole("tab", { name: LINDE.name })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
