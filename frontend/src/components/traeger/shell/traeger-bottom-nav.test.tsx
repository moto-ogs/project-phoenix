import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetTraegerHostCache } from "~/lib/traeger-url";

const { mockPathname, sessionUser } = vi.hoisted(() => ({
  mockPathname: vi.fn(() => "/"),
  sessionUser: { permissions: [] as string[] },
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: sessionUser }, status: "authenticated" }),
}));

// The search reads the school list from the shared cache (#7648).
vi.mock("../use-traeger-schools", () => ({
  useTraegerSchools: () => ({ schools: [], error: null }),
}));

import { TraegerBottomNav } from "./traeger-bottom-nav";
import { TraegerSearchProvider } from "./traeger-search";

const ALL_RIGHTS = [
  "traeger_overview:read",
  "traeger_enrollment:manage",
  "traeger_billing:manage",
  "traeger_accounts:manage",
  "traeger_access_log:read",
];

function bar() {
  return within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
}

describe("TraegerBottomNav", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockPathname.mockReturnValue("/");
    vi.stubEnv("NEXT_PUBLIC_TRAEGER_HOSTNAME", window.location.host);
    _resetTraegerHostCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetTraegerHostCache();
    sessionUser.permissions = [];
  });

  it("follows the sidebar: main navigation, the rest behind Mehr (#5685)", async () => {
    // Ohne Dashboard (#4674): die Reihenfolge der Seitenleiste; was nicht in
    // die Leiste passt, steht hinter „Mehr“. „Anmeldung verwalten“ öffnet
    // seit #4704 zwei Ziele.
    sessionUser.permissions = [
      "traeger_enrollment:manage",
      "traeger_billing:manage",
      "traeger_accounts:manage",
    ];
    render(<TraegerBottomNav />);

    expect(
      bar()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Schulen",
      "Ferienbetreuung",
      "Anmeldephasen",
      "Abrechnungsläufe",
    ]);
    expect(bar().getByRole("link", { name: "Schulen" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(bar().getByRole("button", { name: "Mehr" }));
    const drawer = within(await screen.findByRole("dialog"));
    expect(
      drawer.getByRole("link", { name: "Preise und Ermäßigungen" }),
    ).toHaveAttribute("href", "/abrechnung/preise");
    expect(drawer.getByRole("link", { name: "Hilfe" })).toBeInTheDocument();
    expect(
      drawer.getByRole("link", { name: "Einstellungen" }),
    ).toBeInTheDocument();
  });

  it("puts Hilfe and Einstellungen behind Mehr once the Dashboard fills the bar (#4674, #5685)", async () => {
    sessionUser.permissions = ALL_RIGHTS;
    render(<TraegerBottomNav />);

    expect(
      bar()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Dashboard", "Schulen", "Belegung", "Ferienbetreuung"]);
    expect(bar().getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/uebersicht",
    );

    fireEvent.click(bar().getByRole("button", { name: "Mehr" }));
    const drawer = within(await screen.findByRole("dialog"));
    expect(
      drawer.getByRole("link", { name: "Abrechnungsläufe" }),
    ).toHaveAttribute("href", "/abrechnung");
    expect(
      drawer.getByRole("link", { name: "Familien und Zahlung" }),
    ).toHaveAttribute("href", "/abrechnung/familien");
    expect(drawer.getByRole("link", { name: "Hilfe" })).toHaveAttribute(
      "href",
      "/help?role=traeger",
    );
    expect(drawer.getByRole("link", { name: "Einstellungen" })).toHaveAttribute(
      "href",
      "/einstellungen",
    );
  });

  it("shows the settings with the way back, the rest behind Mehr (#5685)", async () => {
    sessionUser.permissions = ALL_RIGHTS;
    sessionStorage.setItem("traeger-settings-return-path", "/abrechnung");
    mockPathname.mockReturnValue("/einstellungen/abrechnung");
    render(<TraegerBottomNav />);

    expect(
      bar()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Zurück zur App",
      "Allgemein",
      "Mitglieder und Rollen",
      "Briefkopf und Vorlagen",
    ]);
    expect(bar().getByRole("link", { name: "Zurück zur App" })).toHaveAttribute(
      "href",
      "/abrechnung",
    );
    // A page behind Mehr is open: the Mehr field carries the mark and shows
    // that page by its short name, so the bar says where the person is; the
    // accessible name starts with the visible words (WCAG 2.5.3).
    const more = bar().getByRole("button", {
      // The hidden rest of the name follows the visible word (#7112); the
      // name computation may put a space before its comma.
      name: /^Vorgaben ?, Mehr: Abrechnungsvorgaben$/,
    });
    expect(more).toHaveAttribute("data-active", "true");
    expect(more).toHaveTextContent("Vorgaben");

    fireEvent.click(more);
    const drawer = within(await screen.findByRole("dialog"));
    expect(
      drawer.getByRole("link", { name: "Abrechnungsvorgaben" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      drawer.getByRole("link", { name: "Zugriffsprotokoll" }),
    ).toHaveAttribute("href", "/einstellungen/zugriffsprotokoll");
  });

  it("shows only the settings the rights open, all in the bar while they fit", () => {
    sessionUser.permissions = ["traeger_overview:read"];
    mockPathname.mockReturnValue("/einstellungen");
    render(<TraegerBottomNav />);

    expect(bar().getAllByRole("link")).toHaveLength(4);
    expect(bar().queryByRole("button", { name: "Mehr" })).toBeNull();
    expect(bar().getByRole("link", { name: "Allgemein" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("carries the magnifier that opens the search, before Mehr (#7648)", async () => {
    sessionUser.permissions = ALL_RIGHTS;
    render(
      <TraegerSearchProvider>
        <TraegerBottomNav />
      </TraegerSearchProvider>,
    );

    // The magnifier takes one of the five fields: three targets, the
    // magnifier, Mehr.
    expect(
      bar()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Dashboard", "Schulen", "Belegung"]);
    const fields = bar().getAllByRole("listitem");
    expect(fields).toHaveLength(5);
    const search = bar().getByRole("button", { name: "Suchen" });
    expect(fields[3]).toContainElement(search);

    fireEvent.click(search);
    expect(
      await screen.findByRole("combobox", { name: "Suchen" }),
    ).toBeInTheDocument();
  });

  it("keeps the settings bar without the magnifier (#7648)", () => {
    sessionUser.permissions = ALL_RIGHTS;
    mockPathname.mockReturnValue("/einstellungen");
    render(
      <TraegerSearchProvider>
        <TraegerBottomNav />
      </TraegerSearchProvider>,
    );
    expect(bar().queryByRole("button", { name: "Suchen" })).toBeNull();
    expect(bar().getByRole("button", { name: "Mehr" })).toBeInTheDocument();
  });
});
