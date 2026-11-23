import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraegerSchool } from "~/lib/traeger-api";
import { _resetTraegerHostCache } from "~/lib/traeger-url";

const { mockPush, sessionUser, schoolsState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  sessionUser: { permissions: [] as string[] },
  schoolsState: {
    schools: null as TraegerSchool[] | null,
    error: null as unknown,
  },
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/traeger",
  useRouter: () => ({ push: mockPush, prefetch: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: sessionUser }, status: "authenticated" }),
}));

// The list the school page already loaded; the search reads it from the
// shared cache and asks no endpoint of its own.
vi.mock("../use-traeger-schools", () => ({
  useTraegerSchools: () => ({
    schools: schoolsState.schools,
    error: schoolsState.error,
  }),
}));

import { TraegerSearchButton, TraegerSearchProvider } from "./traeger-search";

const SCHOOLS: TraegerSchool[] = [
  {
    id: "7",
    name: "Lindenschule",
    slug: "linden",
    subdomain: "linden",
    city: "Bonn",
  },
  {
    id: "9",
    name: "Grundschule am Park",
    slug: "park",
    subdomain: "park",
    city: "Köln",
  },
];

function renderSearch() {
  return render(
    <TraegerSearchProvider>
      <TraegerSearchButton />
    </TraegerSearchProvider>,
  );
}

function optionNames() {
  return screen
    .queryAllByRole("option")
    .map((option) => option.getAttribute("aria-label"));
}

describe("Träger search (#7648)", () => {
  beforeEach(() => {
    // On the Träger host the paths drop their /traeger prefix.
    vi.stubEnv("NEXT_PUBLIC_TRAEGER_HOSTNAME", window.location.host);
    _resetTraegerHostCache();
    sessionUser.permissions = ["traeger_overview:read"];
    schoolsState.schools = SCHOOLS;
    schoolsState.error = null;
  });

  afterEach(() => {
    mockPush.mockReset();
    vi.unstubAllEnvs();
    _resetTraegerHostCache();
  });

  it("opens with Ctrl+K and Cmd+K, and with the search button", async () => {
    const user = userEvent.setup();
    renderSearch();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    expect(
      await screen.findByRole("combobox", { name: "Suchen" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument(),
    );

    await user.keyboard("{Meta>}k{/Meta}");
    expect(
      await screen.findByRole("combobox", { name: "Suchen" }),
    ).toBeInTheDocument();
    // Cmd/Ctrl+K again closes it, also from inside its field.
    await user.keyboard("{Meta>}k{/Meta}");
    await vi.waitFor(() =>
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Suchen/ }));
    expect(
      await screen.findByRole("combobox", { name: "Suchen" }),
    ).toBeInTheDocument();
  });

  it("finds pages by name and area, and schools by name and city", async () => {
    const user = userEvent.setup();
    renderSearch();
    await user.click(screen.getByRole("button", { name: /Suchen/ }));
    const field = await screen.findByRole("combobox", { name: "Suchen" });

    await user.type(field, "beleg");
    expect(optionNames()).toEqual(["Belegung, Übersicht"]);

    await user.clear(field);
    await user.type(field, "linden");
    expect(
      within(screen.getByRole("group", { name: "Schulen" }))
        .getAllByRole("option")
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual(["Lindenschule, Bonn"]);

    await user.clear(field);
    await user.type(field, "koln");
    expect(optionNames()).toEqual(["Grundschule am Park, Köln"]);
    expect(screen.getByRole("status")).toHaveTextContent("1 Treffer");
  });

  it("leaves out pages the session may not open", async () => {
    const user = userEvent.setup();
    renderSearch();
    await user.click(screen.getByRole("button", { name: /Suchen/ }));
    const field = await screen.findByRole("combobox", { name: "Suchen" });

    // Abrechnungsläufe and the Zugriffsprotokoll need their own rights.
    await user.type(field, "abrechnung");
    expect(optionNames()).toEqual(["Abrechnungsvorgaben, Einstellungen"]);
    await user.clear(field);
    await user.type(field, "protokoll");
    expect(optionNames()).toEqual([]);

    // A settings page the rights open is found too.
    await user.clear(field);
    await user.type(field, "briefkopf");
    expect(optionNames()).toEqual(["Briefkopf und Vorlagen, Einstellungen"]);
  });

  it("opens the marked hit with Enter and a hit by click", async () => {
    const user = userEvent.setup();
    renderSearch();
    await user.click(screen.getByRole("button", { name: /Suchen/ }));
    const field = await screen.findByRole("combobox", { name: "Suchen" });

    await user.type(field, "lindenschule{Enter}");
    expect(mockPush).toHaveBeenCalledWith("/schulen/7");
    await vi.waitFor(() =>
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Suchen/ }));
    await user.type(
      await screen.findByRole("combobox", { name: "Suchen" }),
      "dashboard",
    );
    await user.click(
      screen.getByRole("option", { name: "Dashboard, Übersicht" }),
    );
    expect(mockPush).toHaveBeenLastCalledWith("/uebersicht");
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderSearch();
    await user.click(screen.getByRole("button", { name: /Suchen/ }));
    await user.type(
      await screen.findByRole("combobox", { name: "Suchen" }),
      "xyz",
    );
    expect(screen.getByText("Nichts gefunden")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 Treffer");
  });

  it("shows the load error when the school list failed and nothing matches", async () => {
    const user = userEvent.setup();
    schoolsState.schools = null;
    schoolsState.error = {
      message: "Die Liste der Schulen konnte nicht geladen werden.",
    };
    renderSearch();
    await user.click(screen.getByRole("button", { name: /Suchen/ }));
    const field = await screen.findByRole("combobox", { name: "Suchen" });

    await user.type(field, "dashboard");
    expect(optionNames()).toEqual(["Dashboard, Übersicht"]);
    expect(
      screen.getByText(
        "Die Schulen fehlen gerade. Seiten findest du trotzdem.",
      ),
    ).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "lindenschule");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
