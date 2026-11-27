import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectIdleRenderBudget,
  RENDER_BUDGET_MAX_COMMITS,
} from "~/test/render-budget";

const { mockPathname, mockSearch, sessionUser } = vi.hoisted(() => ({
  mockPathname: vi.fn(() => "/"),
  mockSearch: vi.fn(() => new URLSearchParams()),
  sessionUser: { permissions: [] as string[] },
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearch(),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: sessionUser }, status: "authenticated" }),
}));

import { TraegerReturnPathMemory } from "./traeger-return-path";
import { TraegerSearchProvider } from "./traeger-search";
import { TraegerSidebar } from "./traeger-sidebar";

// The search reads the school list from the shared cache (#7648).
vi.mock("../use-traeger-schools", () => ({
  useTraegerSchools: () => ({ schools: [], error: null }),
}));

const ALL_RIGHTS = [
  "traeger_overview:read",
  "traeger_enrollment:manage",
  "traeger_billing:manage",
  "traeger_accounts:manage",
  "traeger_access_log:read",
];

function mainNav() {
  return within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
}

function bottomNav() {
  return within(
    screen.getByRole("navigation", { name: "Hilfe und Einstellungen" }),
  );
}

function settingsNav() {
  return within(screen.getByRole("navigation", { name: "Einstellungen" }));
}

function linkNames(nav: ReturnType<typeof mainNav>) {
  return nav.getAllByRole("link").map((link) => link.textContent);
}

describe("TraegerSidebar", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    mockPathname.mockReturnValue("/");
    vi.stubEnv("NEXT_PUBLIC_TRAEGER_HOSTNAME", window.location.host);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    sessionUser.permissions = [];
  });

  it("groups the main navigation by task and keeps Personen and Ermäßigungen out (#5685)", () => {
    sessionUser.permissions = ALL_RIGHTS;
    render(<TraegerSidebar />);

    for (const [group, name] of [
      ["Übersicht", "Dashboard"],
      ["Übersicht", "Schulen"],
      ["Betreuung", "Ferienbetreuung"],
      ["Finanzen", "Abrechnungsläufe"],
      ["Finanzen", "Familien und Zahlung"],
      ["Finanzen", "Preise und Ermäßigungen"],
    ] as const) {
      expect(
        within(mainNav().getByRole("list", { name: group })).getByRole("link", {
          name,
        }),
      ).toBeInTheDocument();
    }
    expect(linkNames(mainNav())).toEqual([
      "Dashboard",
      "Schulen",
      "Belegung",
      "Ferienbetreuung",
      // Anmeldephasen für mehrere Schulen, mit demselben Recht (#4704).
      "Anmeldephasen",
      "Schließtage",
      "Dokumente",
      "Abrechnungsläufe",
      "Familien und Zahlung",
      "Preise und Ermäßigungen",
    ]);
    // #7301: moto's billing figures stay in the operator portal.
    expect(
      mainNav().queryByRole("link", { name: "Stichtagszahlen" }),
    ).toBeNull();
    expect(mainNav().getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/uebersicht",
    );
    expect(linkNames(bottomNav())).toEqual(["Hilfe", "Einstellungen"]);
    expect(bottomNav().getByRole("link", { name: "Hilfe" })).toHaveAttribute(
      "href",
      "/help?role=traeger",
    );
    expect(
      bottomNav().getByRole("link", { name: "Einstellungen" }),
    ).toHaveAttribute("href", "/einstellungen");
  });

  it("offers the Tagesmeldung only where a school lies in Mecklenburg-Vorpommern (#4717)", () => {
    sessionUser.permissions = ["traeger_overview:read", "traeger_reports:read"];
    const { unmount } = render(<TraegerSidebar federalStates={["DE-NW"]} />);
    expect(
      mainNav().getByRole("link", { name: "Ankunft und Abholung" }),
    ).toBeInTheDocument();
    expect(
      mainNav().queryByRole("link", { name: "Tagesmeldung" }),
    ).not.toBeInTheDocument();
    unmount();

    render(<TraegerSidebar federalStates={["DE-MV", "DE-NW"]} />);
    expect(
      mainNav().getByRole("link", { name: "Tagesmeldung" }),
    ).toHaveAttribute("href", "/tagesmeldung");
  });

  it("leaves out a group without an open entry", () => {
    sessionUser.permissions = ["traeger_overview:read"];
    render(<TraegerSidebar />);

    // Die Dokumente des Trägers liest jede Rolle (#4692); deshalb bleibt
    // „Betreuung“ mit ihnen stehen, ohne die Ferienbetreuung.
    expect(linkNames(mainNav())).toEqual([
      "Dashboard",
      "Schulen",
      "Belegung",
      "Schließtage",
      "Dokumente",
    ]);
    expect(mainNav().queryByText("Ferienbetreuung")).toBeNull();
    expect(mainNav().queryByText("Anmeldephasen")).toBeNull();
    expect(mainNav().queryByText("Finanzen")).toBeNull();
  });

  it("offers the children of all schools only with „Verträge verwalten“ (#8137)", () => {
    sessionUser.permissions = [
      "traeger_overview:read",
      "traeger_contracts:manage",
    ];
    const { unmount } = render(<TraegerSidebar />);
    // The names of all children need the right that opens the contracts;
    // the entry stands between the schools and their occupancy.
    expect(linkNames(mainNav()).slice(0, 4)).toEqual([
      "Dashboard",
      "Schulen",
      "Kinder",
      "Belegung",
    ]);
    expect(mainNav().getByRole("link", { name: "Kinder" })).toHaveAttribute(
      "href",
      "/kinder",
    );
    unmount();

    sessionUser.permissions = ["traeger_overview:read", "traeger_reports:read"];
    render(<TraegerSidebar />);
    expect(mainNav().getByRole("link", { name: "Belegung" })).toBeVisible();
    expect(mainNav().queryByRole("link", { name: "Kinder" })).toBeNull();
  });

  it("shows the Dashboard only with its right (#4674)", () => {
    sessionUser.permissions = [];
    render(<TraegerSidebar />);

    expect(linkNames(mainNav())).toEqual(["Schulen"]);
  });

  it("replaces the content of the same sidebar in the settings (#5685)", () => {
    sessionUser.permissions = ALL_RIGHTS;
    mockPathname.mockReturnValue("/einstellungen/zugriffsprotokoll");
    render(<TraegerSidebar />);

    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(linkNames(settingsNav())).toEqual([
      "Zurück zur App",
      "Allgemein",
      "Mitglieder und Rollen",
      "Briefkopf und Vorlagen",
      // Wer Verträge schließt, abrechnet und Personal anstellt (#4811).
      "Zuständigkeiten",
      "Abrechnungsvorgaben",
      // Dokumentart je Leistung, für die Rolle „Abrechnung“ (#4688).
      "Dokumentarten",
      "Zugriffsprotokoll",
      // #6052: der Stand der moto-Module, für alle mit dem Recht der Übersicht.
      "moto-Module",
    ]);
    expect(
      settingsNav().getByRole("link", { name: "Zugriffsprotokoll" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      settingsNav().getByRole("link", { name: "Allgemein" }),
    ).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Hauptnavigation" }),
    ).toBeNull();
    // Der Name des Bereichs steht als Überschrift, nie als zweiter Eintrag.
    expect(
      settingsNav().queryByRole("link", { name: "Einstellungen" }),
    ).toBeNull();
    expect(settingsNav().getAllByText("Einstellungen")).toHaveLength(1);
  });

  it("marks Allgemein only on its own page", () => {
    sessionUser.permissions = ALL_RIGHTS;
    mockPathname.mockReturnValue("/einstellungen");
    render(<TraegerSidebar />);

    expect(
      settingsNav().getByRole("link", { name: "Allgemein" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("shows only the settings entries the rights open (#5685)", () => {
    mockPathname.mockReturnValue("/einstellungen");
    sessionUser.permissions = ["traeger_overview:read"];
    const { unmount } = render(<TraegerSidebar />);
    expect(linkNames(settingsNav())).toEqual([
      "Zurück zur App",
      "Allgemein",
      "Briefkopf und Vorlagen",
      "Zuständigkeiten",
      "Abrechnungsvorgaben",
      "moto-Module",
    ]);
    unmount();

    sessionUser.permissions = ["traeger_access_log:read"];
    render(<TraegerSidebar />);
    expect(linkNames(settingsNav())).toEqual([
      "Zurück zur App",
      "Zugriffsprotokoll",
    ]);
  });

  it("opens the first settings page the rights allow", () => {
    sessionUser.permissions = ["traeger_access_log:read"];
    render(<TraegerSidebar />);

    expect(
      bottomNav().getByRole("link", { name: "Einstellungen" }),
    ).toHaveAttribute("href", "/einstellungen/zugriffsprotokoll");
  });

  it("hides Einstellungen when no entry is open to the person", () => {
    sessionUser.permissions = ["traeger_enrollment:manage"];
    render(<TraegerSidebar />);

    expect(
      mainNav().getByRole("link", { name: "Ferienbetreuung" }),
    ).toBeInTheDocument();
    expect(
      bottomNav().getByRole("link", { name: "Hilfe" }),
    ).toBeInTheDocument();
    expect(
      bottomNav().queryByRole("link", { name: "Einstellungen" }),
    ).toBeNull();
  });

  describe("Zurück zur App (#5685)", () => {
    it("leads to the start page without a remembered page", () => {
      sessionUser.permissions = ALL_RIGHTS;
      mockPathname.mockReturnValue("/einstellungen");
      render(<TraegerSidebar />);

      // The start is the dashboard with its right (#7646).
      expect(
        settingsNav().getByRole("link", { name: "Zurück zur App" }),
      ).toHaveAttribute("href", "/uebersicht");
    });

    it("leads to the school list without the dashboard right (#7646)", () => {
      sessionUser.permissions = ["traeger_access_log:read"];
      mockPathname.mockReturnValue("/einstellungen/zugriffsprotokoll");
      render(<TraegerSidebar />);

      expect(
        settingsNav().getByRole("link", { name: "Zurück zur App" }),
      ).toHaveAttribute("href", "/");
    });

    it("leads back to the page opened last, with its filter", () => {
      sessionUser.permissions = ALL_RIGHTS;
      mockPathname.mockReturnValue("/ferien/5/anmeldungen");
      mockSearch.mockReturnValue(new URLSearchParams("status=offen"));
      const memory = render(<TraegerReturnPathMemory />);
      memory.unmount();

      mockPathname.mockReturnValue("/einstellungen/briefkopf");
      mockSearch.mockReturnValue(new URLSearchParams());
      render(
        <>
          <TraegerReturnPathMemory />
          <TraegerSidebar />
        </>,
      );

      expect(
        settingsNav().getByRole("link", { name: "Zurück zur App" }),
      ).toHaveAttribute("href", "/ferien/5/anmeldungen?status=offen");
    });

    it("ignores a stored address that leaves the portal", () => {
      sessionUser.permissions = ALL_RIGHTS;
      sessionStorage.setItem(
        "traeger-settings-return-path",
        "//fremde-seite.example",
      );
      mockPathname.mockReturnValue("/einstellungen");
      render(<TraegerSidebar />);

      expect(
        settingsNav().getByRole("link", { name: "Zurück zur App" }),
      ).toHaveAttribute("href", "/uebersicht");
    });
  });

  describe("collapsible groups (#7647)", () => {
    // Mit dem Recht für die Personalakten, damit alle vier Gruppen stehen.
    const EVERY_GROUP_RIGHTS = [...ALL_RIGHTS, "traeger_staff:manage"];

    function groupHeading(name: string) {
      return mainNav().getByRole("button", { name });
    }

    it("shows every group open to a new person", () => {
      sessionUser.permissions = EVERY_GROUP_RIGHTS;
      mockPathname.mockReturnValue("/ferien");
      render(<TraegerSidebar />);

      for (const name of ["Übersicht", "Betreuung", "Personal", "Finanzen"]) {
        expect(groupHeading(name)).toHaveAttribute("aria-expanded", "true");
      }
    });

    it("keeps a closed group closed after a reload", async () => {
      sessionUser.permissions = EVERY_GROUP_RIGHTS;
      mockPathname.mockReturnValue("/ferien");
      const user = userEvent.setup();
      const first = render(<TraegerSidebar />);

      await user.click(groupHeading("Finanzen"));
      expect(groupHeading("Finanzen")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      first.unmount();

      render(<TraegerSidebar />);
      await act(async () => {});
      expect(groupHeading("Finanzen")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(groupHeading("Übersicht")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      // The OGS app keeps its own key; the portals do not share a state.
      expect(localStorage.getItem("sidebar-open-groups")).toBeNull();
    });

    it("opens the group of the current page even if it was closed", async () => {
      sessionUser.permissions = EVERY_GROUP_RIGHTS;
      localStorage.setItem(
        "traeger-sidebar-open-groups",
        JSON.stringify(["uebersicht"]),
      );
      mockPathname.mockReturnValue("/abrechnung/familien");
      render(<TraegerSidebar />);
      await act(async () => {});

      expect(groupHeading("Finanzen")).toHaveAttribute("aria-expanded", "true");
      expect(groupHeading("Betreuung")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(
        mainNav().getByRole("link", { name: "Familien und Zahlung" }),
      ).toHaveAttribute("aria-current", "page");
    });

    it("toggles a group by keyboard", async () => {
      sessionUser.permissions = EVERY_GROUP_RIGHTS;
      mockPathname.mockReturnValue("/ferien");
      const user = userEvent.setup();
      render(<TraegerSidebar />);

      groupHeading("Finanzen").focus();
      await user.keyboard("{Enter}");
      expect(groupHeading("Finanzen")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await user.keyboard(" ");
      expect(groupHeading("Finanzen")).toHaveAttribute("aria-expanded", "true");
    });
  });

  // Render-Budget (#2939): die Leiste ist auf jeder Seite des Portals
  // gemountet; der Wechsel des Inhalts darf keine Schleife sein.
  describe("render budget", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it.each(["/", "/einstellungen/zugriffsprotokoll"])(
      `commits at most ${RENDER_BUDGET_MAX_COMMITS} times in idle on %s`,
      async (pathname) => {
        vi.useFakeTimers();
        sessionUser.permissions = ALL_RIGHTS;
        mockPathname.mockReturnValue(pathname);

        await expectIdleRenderBudget(<TraegerSidebar />);
      },
    );
  });

  it("puts the search button above the main navigation (#7648)", async () => {
    const user = userEvent.setup();
    sessionUser.permissions = ALL_RIGHTS;
    render(
      <TraegerSearchProvider>
        <TraegerSidebar />
      </TraegerSearchProvider>,
    );

    const search = screen.getByRole("button", { name: /^Suchen/ });
    expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
    // A dialog opener, not a target of the navigation.
    expect(mainNav().queryByRole("button", { name: /^Suchen/ })).toBeNull();

    await user.click(search);
    expect(
      await screen.findByRole("combobox", { name: "Suchen" }),
    ).toBeInTheDocument();
  });

  // #6052: pages of a moto module no school of the Träger booked.
  describe("moto modules that are not booked", () => {
    it("shows them with a lock to who leads the office, and drops the Dashboard", () => {
      sessionUser.permissions = ALL_RIGHTS;
      render(<TraegerSidebar bookedModules={["ferienbetreuung"]} />);

      // The Dashboard is the start page: without Träger-Übersicht the
      // school list takes over, also for who leads the office.
      expect(mainNav().queryByRole("link", { name: /Dashboard/ })).toBeNull();
      expect(
        mainNav().getByRole("link", { name: "Ferienbetreuung" }),
      ).toBeInTheDocument();
      for (const name of ["Belegung", "Abrechnungsläufe"]) {
        const link = mainNav().getByRole("link", {
          name: new RegExp(`^${name} ?, nicht gebucht$`),
        });
        expect(
          within(link).getByTitle(
            "Keine Schule deines Trägers hat dieses moto-Modul gebucht",
          ),
        ).toBeInTheDocument();
      }
      expect(
        mainNav().getByRole("link", { name: "Schulen" }),
      ).toBeInTheDocument();
    });

    it("hides them from everyone else", () => {
      sessionUser.permissions = [
        "traeger_overview:read",
        "traeger_enrollment:manage",
        "traeger_billing:manage",
      ];
      render(<TraegerSidebar bookedModules={["ferienbetreuung"]} />);

      expect(linkNames(mainNav())).toEqual([
        "Schulen",
        "Ferienbetreuung",
        "Anmeldephasen",
        "Schließtage",
        "Dokumente",
      ]);
    });

    it("locks nothing while the booked modules load", () => {
      sessionUser.permissions = ALL_RIGHTS;
      render(<TraegerSidebar bookedModules={null} />);

      expect(
        mainNav().getByRole("link", { name: "Dashboard" }),
      ).toBeInTheDocument();
      expect(
        mainNav().getByRole("link", { name: "Abrechnungsläufe" }),
      ).toBeInTheDocument();
    });

    it("marks Dokumentarten in the settings", () => {
      mockPathname.mockReturnValue("/einstellungen");
      sessionUser.permissions = ALL_RIGHTS;
      render(<TraegerSidebar bookedModules={[]} />);

      expect(
        settingsNav().getByRole("link", {
          name: /^Dokumentarten ?, nicht gebucht$/,
        }),
      ).toBeInTheDocument();
      expect(
        settingsNav().getByRole("link", { name: "Abrechnungsvorgaben" }),
      ).toBeInTheDocument();
    });
  });
});
