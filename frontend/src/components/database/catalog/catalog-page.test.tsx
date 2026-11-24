import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "account-1", tenantId: "1", scope: "tenant" },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));
import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CatalogPage,
  type CatalogConfig,
} from "~/components/database/catalog/catalog-page";
import type { SectionConfig } from "~/lib/database/types";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { deferred } from "~/test/helpers/form-modal-pending";
import { activitiesConcept } from "~/lib/concepts/activities";

const mockUpdateUrlParams = vi.hoisted(() => vi.fn());
vi.mock("~/hooks/useUpdateUrlParams", () => ({
  useUpdateUrlParams: () => mockUpdateUrlParams,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/test-tenant/database/categories",
  useSearchParams: () => new URLSearchParams(),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastWarning = vi.hoisted(() => vi.fn());
const showApiError = vi.hoisted(() => vi.fn());
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useApiErrorDisplay: () => ({ show: showApiError }),
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: vi.fn(),
    remove: vi.fn(),
  }),
}));

interface Sorte {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly sortOrder: number;
}

const ITEMS: Sorte[] = [
  { id: "1", name: "Essen", archived: false, sortOrder: 0 },
  { id: "2", name: "Lernzeit", archived: false, sortOrder: 1 },
  { id: "3", name: "Altes", archived: true, sortOrder: 2 },
];

const sections = (): SectionConfig[] => [
  {
    title: "Eintrag",
    fields: [{ name: "name", label: "Name", type: "text", required: true }],
  },
];

function buildConfig(overrides: Partial<CatalogConfig<Sorte>> = {}) {
  const create = vi.fn().mockResolvedValue(undefined);
  const update = vi.fn().mockResolvedValue(undefined);
  const retire = vi.fn().mockResolvedValue(undefined);
  const restore = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  const reorder = vi.fn().mockResolvedValue(undefined);

  const config: CatalogConfig<Sorte> = {
    concept: activitiesConcept,
    title: "Kategorien",
    singular: "Kategorie",
    purpose: "Kategorien ordnen Termine ein.",
    searchPlaceholder: "Kategorie suchen…",
    emptyDescription: "Legen Sie eine Kategorie an.",
    stats: (items) => `${items.length} Einträge`,
    toRow: (item) => ({
      name: item.name,
      subtitle: item.archived ? "Archiviert" : "In der Auswahl",
      retired: item.archived,
    }),
    sections,
    toFormValues: (item) => ({ name: item.name }),
    createDefaults: { name: "" },
    create,
    update,
    retire: {
      menuLabel: "Archivieren",
      confirmTitle: "Kategorie archivieren?",
      confirmLabel: "Archivieren",
      loadingLabel: "Wird archiviert …",
      describe: (item) => `„${item.name}" wird nicht mehr angeboten.`,
      run: retire,
      toast: (item) => `„${item.name}" archiviert`,
    },
    restore: {
      menuLabel: "Wieder anbieten",
      run: restore,
      toast: (item) => `„${item.name}" wird wieder angeboten`,
    },
    remove: {
      menuLabel: "Löschen",
      confirmTitle: "Kategorie löschen",
      describe: (item) => `„${item.name}" wird gelöscht.`,
      run: remove,
      toast: (item) => `„${item.name}" gelöscht`,
    },
    reorder,
    ...overrides,
  };

  return { config, create, update, retire, restore, remove, reorder };
}

function renderPage(
  options: {
    selectedId?: string | null;
    items?: Sorte[];
    configOverrides?: Partial<CatalogConfig<Sorte>>;
    canManage?: boolean;
    onChanged?: () => Promise<unknown>;
  } = {},
) {
  const built = buildConfig(options.configOverrides);
  const onChanged = options.onChanged ?? vi.fn().mockResolvedValue(undefined);
  render(
    <CatalogPage
      config={built.config}
      items={options.items ?? ITEMS}
      isLoading={false}
      error={null}
      onChanged={onChanged}
      canManage={options.canManage ?? true}
      selectedId={options.selectedId ?? null}
    />,
  );
  return { ...built, onChanged };
}

/** Die Zeile eines Eintrags: der Knopf um seinen Namen, nicht die Pfeile
 *  daneben („Essen nach oben"). */
function row(name: string): HTMLElement {
  const label = screen.getByText(name);
  const button = label.closest("button");
  if (!button) throw new Error(`Keine Zeile für „${name}" gefunden`);
  return button;
}

/** Das Gerüst rendert die Kopfkarte für Telefon und Schreibtisch; beide
 *  Suchfelder hängen am selben Zustand. */
function search(): HTMLElement {
  const fields = screen.getAllByPlaceholderText("Kategorie suchen…");
  const first = fields[0];
  if (!first) throw new Error("Kein Suchfeld gefunden");
  return first;
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Die gemeinsame Fläche der Stammdaten-Kataloge (#3114): Sammlung links,
// Objektansicht rechts, Anlegen als Kopf-Aktion.
describe("CatalogPage", () => {
  it("closes the create dialog when the resource loses its confirmed data", async () => {
    const { config } = buildConfig();
    const props = {
      config,
      items: ITEMS,
      isLoading: false,
      error: null,
      onChanged: vi.fn(),
      canManage: true,
      selectedId: "1",
    };
    const view = render(<CatalogPage {...props} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Kategorie anlegen" })[0]!,
    );
    expect(await screen.findByRole("dialog")).toBeVisible();
    view.rerender(
      <CatalogPage {...props} items={undefined} error="Kein Zugriff" />,
    );
    // Anker: der blockierende Fehler ersetzt den verweigerten Katalog.
    expect(await screen.findByText("Kein Zugriff")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Kategorie anlegen" }),
    ).not.toBeInTheDocument();
  });

  it("splits the collection into what is offered and what is not", () => {
    renderPage();

    expect(row("Essen")).toBeInTheDocument();
    expect(screen.getByText("Nicht mehr in der Auswahl")).toBeInTheDocument();
    expect(row("Altes")).toBeInTheDocument();
  });

  it("puts the chosen entry in the address so a reload shows it again", () => {
    renderPage();

    fireEvent.click(row("Essen"));

    expect(mockUpdateUrlParams).toHaveBeenCalledWith({ eintrag: "1" });
  });

  it("filters the collection by the search", () => {
    renderPage();

    fireEvent.change(search(), { target: { value: "lern" } });

    expect(screen.queryByText("Essen")).not.toBeInTheDocument();
    expect(row("Lernzeit")).toBeInTheDocument();
  });

  it("shows the catalog's purpose above its collection", () => {
    renderPage();

    expect(screen.getByText("Kategorien ordnen Termine ein.")).toBeVisible();
  });

  it("keeps horizontal space around the unselected detail pane", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "Kategorie auswählen" })
        .parentElement,
    ).toHaveClass("px-12");
  });

  it("keeps the open entry while the search hides its row", () => {
    renderPage({ selectedId: "1" });

    fireEvent.change(search(), { target: { value: "lern" } });

    // Die Objektansicht bleibt: sie hängt am Eintrag, nicht an der Zeile.
    expect(screen.getByDisplayValue("Essen")).toBeInTheDocument();
  });

  it("saves an edit at the object", async () => {
    const { update, onChanged } = renderPage({ selectedId: "1" });

    fireEvent.change(screen.getByDisplayValue("Essen"), {
      target: { value: "Mittagessen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        ITEMS[0],
        expect.objectContaining({ name: "Mittagessen" }),
      ),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows a refused save in the form with the catalog text and the field marked", async () => {
    const { update } = renderPage({ selectedId: "1" });
    update.mockRejectedValueOnce(
      new ApiError("a planning track with this name already exists", 409, {
        code: "timetable.planning_track_name_taken",
        errors: [{ field: "name", reason: "taken" }],
      }),
    );

    fireEvent.change(screen.getByDisplayValue("Essen"), {
      target: { value: "Lernzeit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("timetable.planning_track_name_taken", "die Kategorie"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Lernzeit")).toBeInTheDocument();
    expect(showApiError).not.toHaveBeenCalled();
  });

  // ADR 0311: hat jemand den Eintrag seit dem Lesen geändert, lädt die Seite
  // ihn neu, das Formular zeigt den gespeicherten Stand und bietet kein
  // Wiederholen an.
  it("shows the stored entry after a save refused as changed since read", async () => {
    const { update, onChanged } = renderPage({ selectedId: "1" });
    update.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );

    fireEvent.change(screen.getByDisplayValue("Essen"), {
      target: { value: "Lernzeit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Kategorie"),
      ),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByDisplayValue("Essen")).toBeInTheDocument();
    expect(
      screen.getByText(
        catalogText("general.changed_since_read", "die Kategorie"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();
  });

  // ADR 0311 rule 6: after a refusal whose read failed, Speichern sends
  // nothing and leaves the load error with its retry on screen.
  it("keeps the failed read after a refusal on screen and locks Speichern", async () => {
    const onChanged = vi
      .fn()
      .mockRejectedValue(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );
    const { update } = renderPage({ selectedId: "1", onChanged });
    update.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    fireEvent.change(screen.getByDisplayValue("Essen"), {
      target: { value: "Lernzeit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Speichern" });
    await waitFor(() => expect(save).toHaveAttribute("aria-disabled", "true"));

    fireEvent.click(save);
    expect(
      screen.getByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Wiederholen" }),
    ).toBeInTheDocument();
    expect(update).toHaveBeenCalledTimes(1);
  });

  // ADR 0311 rule 2: a reload of the list (a live event, another tab)
  // keeps the typed draft and the entry it was typed over.
  it("keeps an edit and its entry across a reload of the list", async () => {
    const { config, update } = buildConfig();
    const props = {
      config,
      isLoading: false,
      error: null,
      onChanged: vi.fn().mockResolvedValue(undefined),
      canManage: true,
      selectedId: "1",
    };
    const { rerender } = render(<CatalogPage {...props} items={ITEMS} />);
    fireEvent.change(screen.getByDisplayValue("Essen"), {
      target: { value: "Mittagessen" },
    });
    rerender(
      <CatalogPage {...props} items={ITEMS.map((item) => ({ ...item }))} />,
    );
    rerender(
      <CatalogPage
        {...props}
        items={ITEMS.map((item) =>
          item.id === "1" ? { ...item, name: "Essen der Kollegin" } : item,
        )}
      />,
    );
    expect(screen.getByDisplayValue("Mittagessen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        ITEMS[0],
        expect.objectContaining({ name: "Mittagessen" }),
      ),
    );
  });

  // ADR 0311 rules 5 and 6: after a save whose read failed, the next save
  // waits for a read of the stored entry instead of sending the old one.
  it("sends no second save over the old entry when the read after a save failed", async () => {
    const onChanged = vi.fn().mockRejectedValue(new Error("nicht erreichbar"));
    const { update } = renderPage({ selectedId: "1", onChanged });
    fireEvent.change(screen.getByDisplayValue("Essen"), {
      target: { value: "Mittagessen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());

    fireEvent.change(screen.getByDisplayValue("Mittagessen"), {
      target: { value: "Mittagessen 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onChanged.mock.calls.length).toBeGreaterThan(0));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("keeps an edit while the catalog page rerenders", () => {
    renderPage({ selectedId: "1" });

    fireEvent.change(screen.getByDisplayValue("Essen"), {
      target: { value: "Mittagessen" },
    });
    fireEvent.change(search(), { target: { value: "lernzeit" } });

    expect(screen.getByDisplayValue("Mittagessen")).toBeInTheDocument();
  });

  it("keeps a saved edit successful when the refresh fails", async () => {
    const onChanged = vi.fn().mockRejectedValue(new Error("nicht erreichbar"));
    const { update } = renderPage({ selectedId: "1", onChanged });

    fireEvent.change(screen.getByDisplayValue("Essen"), {
      target: { value: "Mittagessen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
    // #6652: the failed reload is a load error above the list that says the
    // change is saved; its retry only reloads.
    expect(
      await screen.findByText((text) => text.endsWith(SAVED_BUT_STALE_SUFFIX)),
    ).toBeInTheDocument();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("keeps the first entry's failed refresh visible in an empty catalog", async () => {
    const onChanged = vi
      .fn()
      .mockRejectedValue(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );
    const { create } = renderPage({ items: [], onChanged });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Kategorie anlegen" })[0]!,
    );
    fireEvent.change(await screen.findByLabelText(/Name/), {
      target: { value: "Essen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Erstellen" }));

    expect(
      await screen.findByText((text) => text.endsWith(SAVED_BUT_STALE_SUFFIX)),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledOnce();
  });

  it("keeps the refresh error visible when the search matches no entries", async () => {
    const onChanged = vi
      .fn()
      .mockRejectedValue(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );
    renderPage({ onChanged });
    fireEvent.click(screen.getByRole("button", { name: "Lernzeit nach oben" }));
    expect(
      await screen.findByText((text) => text.endsWith(SAVED_BUT_STALE_SUFFIX)),
    ).toBeVisible();
    fireEvent.change(search(), { target: { value: "kein Treffer" } });
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeVisible();
  });

  it.each([{ items: [] }, { items: ITEMS }])(
    "keeps an ordinary reload error visible with confirmed data %j",
    ({ items }) => {
      render(
        <CatalogPage
          config={buildConfig().config}
          items={items}
          isLoading={false}
          error="Die Kategorien konnten nicht geladen werden."
          onChanged={vi.fn()}
          canManage
          selectedId={null}
        />,
      );
      if (items.length > 0)
        fireEvent.change(search(), { target: { value: "kein Treffer" } });
      expect(
        screen.getByText("Die Kategorien konnten nicht geladen werden."),
      ).toBeVisible();
    },
  );

  it.each(["archive", "delete"])(
    "closes the %s confirmation before the reload settles",
    async (action) => {
      const reload = deferred();
      const onChanged = vi.fn(() => reload.promise);
      const { retire, remove } = renderPage({ selectedId: "1", onChanged });
      fireEvent.click(
        screen.getByRole("button", { name: /Aktionen für Essen/ }),
      );
      fireEvent.click(
        screen.getByRole("menuitem", {
          name: action === "archive" ? "Archivieren" : "Löschen",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      if (action === "delete")
        fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
      fireEvent.click(
        screen.getByRole("button", {
          name: action === "archive" ? "Archivieren" : "Endgültig löschen",
        }),
      );

      await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
      expect(dialog).not.toBeInTheDocument();
      await act(async () => reload.resolve());
      expect(action === "archive" ? retire : remove).toHaveBeenCalledOnce();
    },
  );

  it("asks before taking an entry out of the selection", async () => {
    const { retire } = renderPage({ selectedId: "1" });

    fireEvent.click(screen.getByRole("button", { name: /Aktionen für Essen/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archivieren" }));

    expect(await screen.findByText(/wird nicht mehr angeboten/)).toBeTruthy();
    expect(retire).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));

    await waitFor(() => expect(retire).toHaveBeenCalledWith(ITEMS[0]));
  });

  it("keeps a completed archive successful when the refresh fails", async () => {
    const onChanged = vi.fn().mockRejectedValue(new Error("nicht erreichbar"));
    const { retire } = renderPage({ selectedId: "1", onChanged });

    fireEvent.click(screen.getByRole("button", { name: /Aktionen für Essen/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archivieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));

    await waitFor(() => expect(retire).toHaveBeenCalledWith(ITEMS[0]));
    expect(toastError).not.toHaveBeenCalled();
    // #6652: the failed reload is a load error above the list that says the
    // change is saved; its retry only reloads.
    expect(
      await screen.findByText((text) => text.endsWith(SAVED_BUT_STALE_SUFFIX)),
    ).toBeInTheDocument();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("offers a retired entry back", async () => {
    const { restore } = renderPage({ selectedId: "3" });

    fireEvent.click(screen.getByRole("button", { name: /Aktionen für Altes/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Wieder anbieten" }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith(ITEMS[2]));
  });

  it("reports a failed write through the shared error path, never its message", async () => {
    const failure = new ApiError("category is archived", 409, {
      code: "general.business_rejection",
    });
    const { restore } = renderPage({ selectedId: "3" });
    restore.mockRejectedValueOnce(failure);

    fireEvent.click(screen.getByRole("button", { name: /Aktionen für Altes/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Wieder anbieten" }));

    await waitFor(() =>
      expect(showApiError).toHaveBeenCalledWith(failure, {
        object: "die Kategorie",
        // Nur eine Ablehnung „seit dem Lesen geändert“ liest neu (ADR 0311).
        reload: expect.any(Function),
      }),
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  // ADR 0311: eine Zeilenaktion über einen veralteten Stand zeigt die
  // Meldung erst mit der neu gelesenen Liste; die nächste Aktion geht von
  // ihr aus.
  it("reads the entries again before it shows a row action refused as changed since reading", async () => {
    const refusal = new ApiError("changed since it was read", 409, {
      code: "general.changed_since_read",
    });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const { restore } = renderPage({ selectedId: "3", onChanged });
    restore.mockRejectedValueOnce(refusal);

    fireEvent.click(screen.getByRole("button", { name: /Aktionen für Altes/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Wieder anbieten" }));

    await waitFor(() => expect(showApiError).toHaveBeenCalled());
    const [shown, options] = showApiError.mock.calls[0] ?? [];
    expect(shown).toBe(refusal);
    onChanged.mockClear();
    await (options as { reload: () => Promise<unknown> }).reload();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("requires restoration before an archived read-only entry can be edited", async () => {
    const { restore } = renderPage({
      selectedId: "3",
      configOverrides: {
        isReadOnly: (item) => item.archived,
        readOnlyHint:
          "Bieten Sie die Kategorie wieder an. Dann können Sie sie ändern.",
      },
    });

    expect(screen.queryByDisplayValue("Altes")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Bieten Sie die Kategorie wieder an. Dann können Sie sie ändern.",
      ),
    ).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Aktionen für Altes/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Wieder anbieten" }));

    await waitFor(() => expect(restore).toHaveBeenCalledWith(ITEMS[2]));
  });

  it("reorders through the visible arrows", async () => {
    const { reorder } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Lernzeit nach oben" }));

    await waitFor(() => expect(reorder).toHaveBeenCalledWith(["2", "1"]));
  });

  it("keeps hidden active entries in the reorder payload", async () => {
    const { reorder } = renderPage({
      items: [
        { id: "1", name: "Essen", archived: false, sortOrder: 0 },
        { id: "2", name: "Lernzeit A", archived: false, sortOrder: 1 },
        { id: "3", name: "Lernzeit B", archived: false, sortOrder: 2 },
      ],
    });

    fireEvent.change(search(), { target: { value: "lernzeit" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Lernzeit B nach oben" }),
    );

    await waitFor(() => expect(reorder).toHaveBeenCalledWith(["1", "3", "2"]));
  });

  it("carries no reorder arrows when a single entry has no order", () => {
    const single = ITEMS[0];
    if (!single) throw new Error("Beispieldaten fehlen");
    renderPage({ items: [single] });

    // Anker: die Sammlung mit dem einzigen Eintrag ist gerendert.
    expect(row("Essen")).toBeInTheDocument();
    // Zwei dauerhaft graue Pfeile neben dem einzigen Eintrag sind
    // Bedienelemente, die nie etwas tun.
    expect(
      screen.queryByRole("button", { name: /nach oben/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /nach unten/ }),
    ).not.toBeInTheDocument();
  });

  it("carries reorder arrows once a second entry gives an order", () => {
    const [first, second] = ITEMS;
    if (!first || !second) throw new Error("Beispieldaten fehlen");
    renderPage({ items: [first, second] });

    expect(screen.getAllByRole("button", { name: /nach oben/ })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("button", { name: /nach unten/ })).toHaveLength(
      2,
    );
  });

  it("hides every write affordance without the permission", () => {
    renderPage({ selectedId: "1", canManage: false });

    expect(
      screen.queryByRole("button", { name: "Kategorie anlegen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Aktionen für Essen/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Essen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Essen/ })).toBeInTheDocument();
  });

  it("shows a load error instead of an empty collection", () => {
    render(
      <CatalogPage
        config={buildConfig().config}
        items={undefined}
        isLoading={false}
        error="Die Kategorien konnten nicht geladen werden."
        onChanged={vi.fn()}
        canManage
        selectedId={null}
      />,
    );

    expect(
      screen.getByText("Die Kategorien konnten nicht geladen werden."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Noch keine Kategorien")).not.toBeInTheDocument();
  });

  it("offers the next step when nothing is there yet", () => {
    renderPage({ items: [] });

    expect(screen.getByText("Noch keine Kategorien")).toBeInTheDocument();
    expect(
      screen.getByText("Legen Sie eine Kategorie an."),
    ).toBeInTheDocument();
    expect(document.body.querySelectorAll("[data-icon-only]")).toHaveLength(1);
  });
});
