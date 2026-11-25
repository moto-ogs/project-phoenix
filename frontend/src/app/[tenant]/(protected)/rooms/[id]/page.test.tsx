import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSession } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roomKeys } from "~/lib/swr/rooms-keys";
import RoomDetailPage from "./page-content";

const {
  searchParams,
  pushMock,
  useRoomDetailMock,
  presenceModeState,
  serviceUpdateMock,
  serviceDeleteMock,
  toastSuccessMock,
  toastErrorMock,
  exportPlanMock,
  showErrorMock,
  refreshSupervisionMock,
  supervisionState,
  suspendSearchParamsState,
  weekendOpenState,
  tenantMutateMock,
} = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  pushMock: vi.fn(),
  useRoomDetailMock: vi.fn(),
  presenceModeState: { mode: "detailed" as string },
  serviceUpdateMock: vi.fn(() => Promise.resolve({})),
  serviceDeleteMock: vi.fn(() => Promise.resolve("delete" as const)),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  exportPlanMock: vi.fn(() => Promise.resolve()),
  showErrorMock: vi.fn(() => Promise.resolve()),
  refreshSupervisionMock: vi.fn(() => Promise.resolve()),
  supervisionState: { overviewEnabled: false },
  suspendSearchParamsState: { value: false },
  weekendOpenState: { value: false },
  tenantMutateMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("next-auth/react", () => ({ useSession: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "7" }),
  usePathname: () => "/rooms/7",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => {
    if (suspendSearchParamsState.value) throw new Promise(() => {});
    return searchParams;
  },
}));

vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("~/lib/supervision-context", () => ({
  useOptionalSupervision: () => ({
    overviewEnabled: supervisionState.overviewEnabled,
    refresh: refreshSupervisionMock,
  }),
}));

vi.mock("~/lib/breadcrumb-context", () => ({
  useSetBreadcrumb: vi.fn(),
}));

vi.mock("~/lib/tenant-context", () => ({
  usePresenceMode: () => presenceModeState.mode,
  useWeekendFollowsFriday: () => weekendOpenState.value,
  useTenantSafe: () => null,
  useTenantSlugSafe: () => null,
  useTenantRoutingModeSafe: () => "subdomain",
}));

// Nur die Toasts ersetzen; der Fehlerweg (Katalogtexte) bleibt echt.
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({ success: toastSuccessMock, error: toastErrorMock }),
  // Der Exportfehler des Raumplans geht als Toast über den Fehlerweg.
  useApiErrorDisplay: () => ({ show: showErrorMock }),
}));

// The removal preview of a room (#6845), as the removal API answers it.
const { removalImpact } = vi.hoisted(() => ({
  removalImpact: {
    outcome: "delete",
    active_session: false,
    care_offering: false,
    references: {
      activity_groups: 0,
      upcoming_blocks: 0,
      education_groups: 0,
      devices: 0,
      past_blocks: 0,
      archived_activity_groups: 0,
      has_session_history: false,
    },
    fingerprint: "vorschau-1",
  },
}));

vi.mock("~/lib/swr", () => ({
  // Der Löschdialog liest seine Vorschau aus dem gemeinsamen Cache.
  useSWRAuth: (key: string | null) => ({
    data: key?.startsWith("room-removal-impact-") ? removalImpact : undefined,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: () => Promise.resolve(undefined),
  }),
  useSWRSeedFrom: () => () => undefined,
  useTenantMutate: () => tenantMutateMock,
  useTenantMutateMatching: () => vi.fn(() => Promise.resolve()),
}));

vi.mock("~/lib/database/service-factory", () => ({
  createCrudService: () => ({
    update: serviceUpdateMock,
  }),
}));

// Löschen geht direkt an den Raum-Client: dessen ApiError trägt Code und
// Vorgangskennung in den Löschdialog (#2517).
vi.mock("~/lib/room-removal-api", () => ({
  fetchRoomRemovalImpact: () => Promise.resolve(removalImpact),
  removeRoom: serviceDeleteMock,
}));

vi.mock("~/components/rooms/room-detail-content", () => ({
  useRoomDetail: (roomId: string) => useRoomDetailMock(roomId),
  RoomDetailContent: ({ room }: { room: { name: string } }) => (
    <div data-testid="room-overview">{room.name}</div>
  ),
  RoomDetailSkeleton: () => <div data-testid="room-detail-skeleton" />,
}));

// Die Sperren (#7653) haben ihren eigenen Test; hier zählt nur der Reiter.
vi.mock("~/components/rooms/room-closures-section", () => ({
  RoomClosuresSection: () => null,
}));

vi.mock("~/components/rooms/room-stammdaten-tab", () => ({
  RoomStammdatenTab: ({
    onSave,
    room,
    showOccupancy,
  }: {
    onSave: (data: { name?: string; isOpenRoom?: boolean }) => Promise<void>;
    room: { isOpenRoom?: boolean };
    showOccupancy: boolean;
  }) => (
    <div
      data-testid="room-stammdaten"
      data-show-occupancy={String(showOccupancy)}
    >
      <button type="button" onClick={() => void onSave({ name: "Neu" })}>
        Speichern
      </button>
      <button
        type="button"
        onClick={() => void onSave({ isOpenRoom: !room.isOpenRoom })}
      >
        Freigabe ändern
      </button>
    </div>
  ),
}));

// Der Reiter „Plan“ (#4768) hat seine eigenen Tests (room-plan-tab.test.tsx);
// hier zählt, wann die Seite ihn zeigt und was sie ihm übergibt.
vi.mock("~/components/rooms/room-plan-lazy", () => ({
  RoomPlanControls: ({
    planHref,
    planLinkLabel,
    onChange,
  }: {
    planHref: string;
    planLinkLabel: string;
    onChange: (next: { view?: string; d?: string }) => void;
  }) => (
    <div data-testid="room-plan-controls">
      <a href={planHref}>{planLinkLabel}</a>
      <button type="button" onClick={() => onChange({ view: "tag" })}>
        Tag
      </button>
    </div>
  ),
  RoomPlanTab: ({
    roomId,
    view,
    anchorISO,
  }: {
    roomId: string;
    view: string;
    anchorISO: string;
  }) => (
    <div
      data-testid="room-plan"
      data-room={roomId}
      data-view={view}
      data-day={anchorISO}
    />
  ),
}));

vi.mock("~/components/rooms/room-plan-navigation", () => ({
  parseRoomPlanView: (raw: string | null) => (raw === "tag" ? "tag" : "woche"),
  useRoomPlanHref: (
    roomId: string,
    view: string,
    day: string,
    canManage: boolean,
  ) =>
    `${canManage ? "/betreuungsplan" : "/calendar"}?room=${roomId}&d=${day}&view=${view}`,
}));

vi.mock("~/lib/plan-export-api", () => ({
  exportPlan: exportPlanMock,
}));

vi.mock("~/components/ui/confirm-delete-modal", () => ({
  ConfirmDeleteModal: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div data-testid="confirm-delete">
        <button type="button" onClick={onConfirm}>
          Bestätigen
        </button>
      </div>
    ) : null,
}));

vi.mock("./page-skeleton", () => ({
  RoomDetailLoadingPage: ({
    backLabel,
    info,
  }: {
    backLabel?: string;
    info?: string;
  }) => (
    <div
      data-testid="room-loading"
      data-back-label={backLabel}
      data-info={info}
    />
  ),
}));

const room = {
  id: "7",
  name: "Gruppenraum Sonne",
  building: "Hauptgebäude",
  floor: 1,
  category: "Gruppenraum",
  capacity: 20,
  isOccupied: true,
};

function mockSession(permissions: string[], roles: string[] = []) {
  vi.mocked(useSession).mockReturnValue({
    data: {
      user: { id: "1", token: "t", permissions, roles },
      expires: "2099-01-01",
    },
    status: "authenticated",
    update: vi.fn(),
  } as ReturnType<typeof useSession>);
}

describe("RoomDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/rooms/7");
    searchParams.delete("from");
    searchParams.delete("tab");
    searchParams.delete("d");
    searchParams.delete("view");
    presenceModeState.mode = "detailed";
    supervisionState.overviewEnabled = false;
    suspendSearchParamsState.value = false;
    weekendOpenState.value = false;
    useRoomDetailMock.mockReturnValue({
      room,
      history: [],
      loading: false,
      error: null,
      historyDisabled: false,
    });
    mockSession(["rooms:read"]);
  });

  it("shows the overview with name, status line and status badge", () => {
    render(<RoomDetailPage />);

    expect(
      screen.getByRole("heading", { name: "Gruppenraum Sonne" }),
    ).toBeInTheDocument();
    // Statuszeile ohne Trennpunkt und mit höchstens drei Angaben (#7402):
    // die Etage entfällt, sie steht unter „Rauminformationen“.
    expect(
      screen.getByText("Hauptgebäude").parentElement?.parentElement,
    ).toHaveTextContent(/^Hauptgebäude, Gruppenraum, 20 Plätze$/);
    expect(screen.queryByText("Etage 1")).not.toBeInTheDocument();
    const statusPill = screen.getByText("Belegt").closest("[data-status-pill]");
    expect(statusPill).toBeInTheDocument();
    // Die Plakette ist direktes Kind der Kopfaktionen; nur dann nimmt die
    // Ausnahme für Status-Plaketten ihr auf dem Telefon nicht die eigene Größe.
    expect(statusPill?.parentElement).toHaveClass(
      "max-sm:[&>*:not([data-icon-only]):not([data-status-pill])]:basis-full",
    );
    expect(screen.getByTestId("room-overview")).toBeInTheDocument();
    // Ohne rooms:update gibt es keinen Stammdaten-Reiter und keine
    // Reiterleiste; ohne rooms:delete kein Kebab.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Weitere Aktionen" }),
    ).not.toBeInTheDocument();
  });

  // Offene Räume stehen seit #4372 nur noch unter „Räume“: ihre gemeinsame
  // Aufsichtsansicht öffnet die Raumseite.
  it("opens the shared supervision view of an open room", () => {
    mockSession(["rooms:read", "groups:read"], ["user"]);
    useRoomDetailMock.mockReturnValue({
      room: { ...room, isOpenRoom: true },
      history: [],
      loading: false,
      error: null,
      historyDisabled: false,
    });
    render(<RoomDetailPage />);

    expect(screen.getByRole("link", { name: "Zur Aufsicht" })).toHaveAttribute(
      "href",
      "/active-supervisions?room=7",
    );
  });

  it("opens the shared supervision view for a custom staff role", () => {
    mockSession(["rooms:read", "groups:read"], ["Honorarkraft"]);
    useRoomDetailMock.mockReturnValue({
      room: { ...room, isOpenRoom: true },
      history: [],
      loading: false,
      error: null,
      historyDisabled: false,
    });
    render(<RoomDetailPage />);

    expect(screen.getByRole("link", { name: "Zur Aufsicht" })).toHaveAttribute(
      "href",
      "/active-supervisions?room=7",
    );
  });

  it("hides the supervision view from a caregiver without groups:read", () => {
    mockSession(["rooms:read"], ["user"]);
    useRoomDetailMock.mockReturnValue({
      room: { ...room, isOpenRoom: true },
      history: [],
      loading: false,
      error: null,
      historyDisabled: false,
    });
    render(<RoomDetailPage />);

    expect(screen.getByText("Belegt")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Zur Aufsicht" }),
    ).not.toBeInTheDocument();
  });

  it("offers the supervision view to staff covered by the school overview", () => {
    supervisionState.overviewEnabled = true;
    useRoomDetailMock.mockReturnValue({
      room: { ...room, isOpenRoom: true },
      history: [],
      loading: false,
      error: null,
      historyDisabled: false,
    });
    render(<RoomDetailPage />);

    expect(
      screen.getByRole("link", { name: "Zur Aufsicht" }),
    ).toBeInTheDocument();
  });

  it("offers no supervision view for a closed room or without access", () => {
    mockSession(["rooms:read"], ["user"]);
    const { unmount } = render(<RoomDetailPage />);
    // Anker: die Raumseite ist geladen.
    expect(screen.getByText("Belegt")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Zur Aufsicht" }),
    ).not.toBeInTheDocument();
    unmount();

    // Ohne Betreuungsrolle und ohne Schulübersicht sperrt die Aufsichtsseite.
    mockSession(["rooms:read"]);
    useRoomDetailMock.mockReturnValue({
      room: { ...room, isOpenRoom: true },
      history: [],
      loading: false,
      error: null,
      historyDisabled: false,
    });
    render(<RoomDetailPage />);
    expect(screen.getByText("Belegt")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Zur Aufsicht" }),
    ).not.toBeInTheDocument();
  });

  it("offers the Stammdaten tab to editors and saves through the service", async () => {
    mockSession(["rooms:update"]);
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Stammdaten" }));
    expect(window.location.pathname + window.location.search).toBe(
      "/rooms/7?tab=stammdaten",
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(serviceUpdateMock).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({ name: "Neu" }),
      );
    });
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  // The answer of the save carries the new version (ADR 0311): the next save
  // of the same person sends it even when the reload after this one fails.
  it("writes the saved room with its new version into the detail cache", async () => {
    mockSession(["rooms:update"]);
    serviceUpdateMock.mockResolvedValueOnce({
      ...room,
      name: "Neu",
      isOccupied: false,
      version: "v2",
    });
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Stammdaten" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    const write = (tenantMutateMock.mock.calls as unknown[][]).find(
      ([, data]) => typeof data === "function",
    );
    expect(write?.[0]).toBe(roomKeys.detailKey("7"));
    expect(write?.[2]).toEqual({ revalidate: false });
    const update = write?.[1] as (current: unknown) => {
      room: { name: string; version?: string; isOccupied: boolean };
    };
    const cached = update({ room: { ...room, version: "v1" }, history: [] });
    expect(cached.room).toMatchObject({ name: "Neu", version: "v2" });
    expect(cached.room.isOccupied).toBe(true);
    expect(refreshSupervisionMock).toHaveBeenCalledWith();
  });

  it.each([true, false])(
    "refreshes only released rooms after setting the release to %s",
    async (isOpenRoom) => {
      mockSession(["rooms:update"]);
      useRoomDetailMock.mockReturnValue({
        room: { ...room, isOpenRoom: !isOpenRoom },
        history: [],
        loading: false,
        error: null,
        historyDisabled: false,
      });
      serviceUpdateMock.mockResolvedValueOnce({ ...room, isOpenRoom });
      render(<RoomDetailPage />);

      fireEvent.click(screen.getByRole("tab", { name: "Stammdaten" }));
      fireEvent.click(screen.getByRole("button", { name: "Freigabe ändern" }));

      await waitFor(() =>
        expect(refreshSupervisionMock).toHaveBeenCalledWith(["released-rooms"]),
      );
      expect(serviceUpdateMock).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({ isOpenRoom }),
      );
    },
  );

  it("keeps the referrer when switching room tabs", () => {
    mockSession(["rooms:update"]);
    searchParams.set("from", "/database/rooms?groupBy=floor");
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Stammdaten" }));

    expect(window.location.pathname + window.location.search).toBe(
      "/rooms/7?from=%2Fdatabase%2Frooms%3FgroupBy%3Dfloor&tab=stammdaten",
    );
  });

  it("opens Stammdaten directly from a deep link", () => {
    mockSession(["rooms:update"]);
    searchParams.set("tab", "stammdaten");
    render(<RoomDetailPage />);

    expect(screen.getByTestId("room-stammdaten")).toBeInTheDocument();
    expect(screen.getByTestId("room-stammdaten")).toHaveAttribute(
      "data-show-occupancy",
      "true",
    );
    expect(screen.queryByTestId("room-overview")).not.toBeInTheDocument();
  });

  it("deletes the room after confirmation and returns to the referrer", async () => {
    mockSession(["rooms:delete"]);
    searchParams.set("from", "/database/rooms?groupBy=floor");
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Löschen" }));
    // Die Vorschau lädt, bevor die Rückfrage den Raum entfernt (#6845).
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));
      expect(serviceDeleteMock).toHaveBeenCalledWith("7", "vorschau-1");
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/database/rooms?groupBy=floor");
    });
    expect(refreshSupervisionMock).toHaveBeenCalledWith();
  });

  it("marks an archived room and offers neither editing nor removal", () => {
    mockSession(["rooms:delete", "rooms:update"]);
    useRoomDetailMock.mockReturnValue({
      room: { ...room, archivedAt: "2026-11-13T10:00:00Z" },
      history: [],
      loading: false,
      error: null,
      historyDisabled: false,
    });
    render(<RoomDetailPage />);

    expect(screen.getByText("Archivierter Raum")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Weitere Aktionen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Stammdaten" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer deleting a system room", () => {
    mockSession(["rooms:delete"]);
    useRoomDetailMock.mockReturnValue({
      room: { ...room, name: "Schulhof" },
      history: [],
      loading: false,
      error: null,
      historyDisabled: false,
    });
    render(<RoomDetailPage />);

    // Anker: die Raumakte ist geladen, nur das Aktionsmenü fehlt.
    expect(screen.getAllByText("Schulhof").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Weitere Aktionen" }),
    ).not.toBeInTheDocument();
  });

  it("shows only the Stammdaten in binary presence mode", () => {
    mockSession(["rooms:update"]);
    presenceModeState.mode = "binary";
    render(<RoomDetailPage />);

    expect(screen.getByTestId("room-stammdaten")).toBeInTheDocument();
    expect(screen.getByTestId("room-stammdaten")).toHaveAttribute(
      "data-show-occupancy",
      "false",
    );
    expect(screen.queryByTestId("room-overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Belegt")).not.toBeInTheDocument();
  });

  it("shows read-only room information in binary presence mode", () => {
    presenceModeState.mode = "binary";
    render(<RoomDetailPage />);

    expect(screen.getByTestId("room-overview")).toBeInTheDocument();
    expect(screen.queryByTestId("room-stammdaten")).not.toBeInTheDocument();
  });

  it("explains the room's occupancy, or only its record in binary mode", () => {
    const { unmount } = render(<RoomDetailPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Erklärung zu Gruppenraum Sonne" }),
    );
    expect(
      screen.getByText(
        "Hier siehst du, ob dieser Raum belegt ist. Unter „Kinder im Raum“ stehen die Kinder, die gerade dort sind. Wähle ein Kind, um seine Angaben zu öffnen.",
      ),
    ).toBeInTheDocument();
    unmount();

    presenceModeState.mode = "binary";
    render(<RoomDetailPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Erklärung zu Gruppenraum Sonne" }),
    );
    expect(
      screen.getByText(
        "Hier stehen die Angaben zu diesem Raum. Deine Schule erfasst nicht, welche Kinder in welchem Raum sind.",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to the room list for an external referrer", () => {
    searchParams.set("from", "//attacker.example");
    render(<RoomDetailPage />);

    expect(
      screen.getByRole("link", { name: "Zurück zu den Räumen" }),
    ).toHaveAttribute("href", "/rooms");
  });

  it("renders the loading page with the referrer's back label", () => {
    useRoomDetailMock.mockReturnValue({
      room: null,
      history: [],
      loading: true,
      error: null,
      historyDisabled: false,
    });
    searchParams.set("from", "/database/rooms");
    render(<RoomDetailPage />);

    expect(screen.getByTestId("room-loading")).toHaveAttribute(
      "data-back-label",
      "Zurück zu den Räumen der Datenverwaltung",
    );
    expect(screen.getByTestId("room-loading")).toHaveAttribute(
      "data-info",
      "Hier siehst du, ob dieser Raum belegt ist. Unter „Kinder im Raum“ stehen die Kinder, die gerade dort sind. Wähle ein Kind, um seine Angaben zu öffnen.",
    );
  });

  it("explains room occupancy while the page is suspended", () => {
    suspendSearchParamsState.value = true;
    render(<RoomDetailPage />);

    expect(screen.getByTestId("room-loading")).toHaveAttribute(
      "data-info",
      "Hier siehst du, ob dieser Raum belegt ist. Unter „Kinder im Raum“ stehen die Kinder, die gerade dort sind. Wähle ein Kind, um seine Angaben zu öffnen.",
    );
  });

  it("renders the error state when the room cannot be loaded", () => {
    useRoomDetailMock.mockReturnValue({
      room: null,
      history: [],
      loading: false,
      error: "Fehler beim Laden der Raumdaten.",
      historyDisabled: false,
    });
    render(<RoomDetailPage />);

    expect(
      screen.getByText("Fehler beim Laden der Raumdaten."),
    ).toBeInTheDocument();
  });
  // --- Reiter „Plan“ (#4768) ---

  it("offers the Plan tab with the read permission of the Betreuungsplan", () => {
    mockSession(["rooms:read", "schedules:read"]);
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    expect(window.location.pathname + window.location.search).toBe(
      "/rooms/7?tab=plan",
    );
  });

  it("hides the Plan tab without schedules:read", () => {
    mockSession(["rooms:read", "rooms:update"]);
    render(<RoomDetailPage />);

    expect(screen.getByRole("tab", { name: "Stammdaten" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Plan" })).not.toBeInTheDocument();
  });

  it("opens the room's plan from a deep link and links to the read-only plan", async () => {
    mockSession(["rooms:read", "schedules:read"]);
    searchParams.set("tab", "plan");
    searchParams.set("d", "2026-09-09");
    searchParams.set("view", "tag");
    render(<RoomDetailPage />);

    const plan = await screen.findByTestId("room-plan");
    expect(plan).toHaveAttribute("data-room", "7");
    expect(plan).toHaveAttribute("data-view", "tag");
    expect(plan).toHaveAttribute("data-day", "2026-09-09");
    expect(screen.queryByTestId("room-overview")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Im Betreuungsplan ansehen" }),
    ).toHaveAttribute("href", "/calendar?room=7&d=2026-09-09&view=tag");
  });

  it("sends planners to the editable Betreuungsplan of the room", () => {
    mockSession(["rooms:read", "schedules:read", "schedules:manage"]);
    searchParams.set("tab", "plan");
    render(<RoomDetailPage />);

    expect(
      screen.getByRole("link", { name: "Im Betreuungsplan bearbeiten" }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/betreuungsplan\?room=7&/),
    );
  });

  it("keeps the tab when the plan changes its day or view", () => {
    mockSession(["rooms:read", "schedules:read"]);
    searchParams.set("tab", "plan");
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    expect(window.location.pathname + window.location.search).toBe(
      "/rooms/7?tab=plan&view=tag",
    );
  });

  it("drops the plan parameters when leaving the Plan tab", () => {
    mockSession(["rooms:read", "rooms:update", "schedules:read"]);
    searchParams.set("tab", "plan");
    searchParams.set("d", "2026-09-09");
    searchParams.set("view", "tag");
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("tab", { name: "Stammdaten" }));
    expect(window.location.pathname + window.location.search).toBe(
      "/rooms/7?tab=stammdaten",
    );
  });

  it("downloads the room's plan of the shown week as PDF", async () => {
    mockSession(["rooms:read", "schedules:read", "users:read"]);
    searchParams.set("tab", "plan");
    searchParams.set("d", "2026-09-09");
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Raumplan als PDF" }));
    await waitFor(() => expect(exportPlanMock).toHaveBeenCalledTimes(1));
    expect(exportPlanMock).toHaveBeenCalledWith(
      "betreuungsplan",
      {
        from: "2026-09-09",
        to: "2026-09-09",
        template: "offerings",
        variant: "aushang",
        filter: { groupId: null, staffId: null, roomId: "7" },
      },
      "pdf",
      "download",
    );
  });

  it("exports the displayed Monday for a weekend deep link", async () => {
    mockSession(["rooms:read", "schedules:read", "users:read"]);
    searchParams.set("tab", "plan");
    searchParams.set("d", "2026-09-12");
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Raumplan als PDF" }));
    await waitFor(() =>
      expect(exportPlanMock).toHaveBeenCalledWith(
        "betreuungsplan",
        expect.objectContaining({ from: "2026-09-14", to: "2026-09-14" }),
        "pdf",
        "download",
      ),
    );
  });

  it("shows a failed room plan export as an error", async () => {
    mockSession(["rooms:read", "schedules:read", "users:read"]);
    exportPlanMock.mockRejectedValueOnce(new Error("offline"));
    searchParams.set("tab", "plan");
    render(<RoomDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Raumplan als PDF" }));
    await waitFor(() =>
      expect(showErrorMock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ object: "das Erstellen des Raumplans" }),
      ),
    );
  });

  it("offers no room plan PDF without users:read", () => {
    mockSession(["rooms:read", "schedules:read"]);
    searchParams.set("tab", "plan");
    render(<RoomDetailPage />);

    // Anker: der Plan ist da, das Menü fehlt mangels Einträgen.
    expect(screen.getByTestId("room-plan")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Weitere Aktionen" }),
    ).not.toBeInTheDocument();
  });

  it("shows the plan beside the room information in binary presence mode", async () => {
    presenceModeState.mode = "binary";
    mockSession(["rooms:read", "schedules:read"]);
    render(<RoomDetailPage />);

    expect(screen.getByTestId("room-overview")).toBeInTheDocument();
    expect(await screen.findByTestId("room-plan")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
