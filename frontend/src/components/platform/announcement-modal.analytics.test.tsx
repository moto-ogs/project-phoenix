import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Einstieg messen (#7555): die Ankündigung meldet „gesehen“ an das Backend
// und angezeigt, angenommen, geschlossen über die echte Erfassung (Gate für
// Schule und Einwilligung); nur das SDK und die Daten sind ersetzt.
const mocks = vi.hoisted(() => ({
  env: {
    NEXT_PUBLIC_POSTHOG_KEY: "phc_test_key_123" as string | undefined,
    NEXT_PUBLIC_TENANT_DOMAIN: "localhost",
    NEXT_PUBLIC_OPERATOR_HOSTNAME: "operator.localhost:3000",
    NEXT_PUBLIC_PARENTS_HOSTNAME: "parents.localhost:3000",
    NEXT_PUBLIC_SCHOOL_HOSTNAME: "schule.localhost:3000",
    NEXT_PUBLIC_CATERER_HOSTNAME: "caterer.localhost:3000",
    NEXT_PUBLIC_TRAEGER_HOSTNAME: "traeger.localhost:3000",
  },
  init: vi.fn(),
  capture: vi.fn(),
  markSeen: vi.fn(),
  dismiss: vi.fn(),
  announcements: [] as Array<{
    id: number;
    title: string;
    content: string;
    type: string;
    severity: string;
    published_at: string;
  }>,
}));

vi.mock("~/env.client", () => ({ clientEnv: mocks.env }));
vi.mock("posthog-js", () => ({
  default: {
    init: mocks.init,
    capture: mocks.capture,
    stopSessionRecording: vi.fn(),
    opt_out_capturing: vi.fn(),
    opt_in_capturing: vi.fn(),
    register: vi.fn(),
    reset: vi.fn(),
    unregister: vi.fn(),
    set_config: vi.fn(),
    identify: vi.fn(),
    get_distinct_id: vi.fn(() => "0199aa2b-anon"),
  },
}));
vi.mock("~/lib/hooks/use-announcements", () => ({
  useAnnouncements: () => ({
    announcements: mocks.announcements,
    isLoading: false,
    dismiss: mocks.dismiss,
    // A new function on every render, as an unmemoized hook would return:
    // the modal must not report again just because the render ran again.
    markSeen: (id: number | string) => mocks.markSeen(id) as Promise<void>,
    refresh: vi.fn(),
  }),
}));
// Das Modal-Gerüst ist ersetzt: sein X ruft onClose wie Escape und Hintergrund.
vi.mock("~/components/ui/modal", () => ({
  Modal: ({
    isOpen,
    onClose,
    children,
    footer,
  }: {
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
    footer: ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <button type="button" onClick={onClose}>
          Schließen
        </button>
        {children}
        {footer}
      </div>
    ) : null,
}));

function announcement(id: number, title: string) {
  return {
    id,
    title,
    content: "Inhalt",
    type: "release",
    severity: "info",
    published_at: "2026-09-01T08:00:00Z",
  };
}

/** Lädt Modal und Erfassung frisch, mit dem gegebenen Einwilligungsstand. */
async function setup(consent: boolean | undefined) {
  const client = await import("~/lib/posthog-client");
  client.setAnalyticsContext({ enabled: true, consent });
  await client.initializePostHog();
  const { AnnouncementModal } = await import("./announcement-modal");
  return { AnnouncementModal };
}

function surfaceEvents() {
  return mocks.capture.mock.calls.filter(([event]) =>
    String(event).startsWith("onboarding_surface_"),
  );
}

describe("AnnouncementModal analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.markSeen.mockResolvedValue(undefined);
    mocks.dismiss.mockResolvedValue(undefined);
    mocks.announcements = [announcement(1, "Erste"), announcement(2, "Zweite")];
    vi.stubGlobal("requestIdleCallback", vi.fn());
    vi.stubEnv("NEXT_PUBLIC_TENANT_DOMAIN", "localhost");
    window.history.replaceState(null, "", "/dashboard");
    vi.stubGlobal("location", {
      ...window.location,
      host: "school-a.localhost:3000",
      hostname: "school-a.localhost",
      href: "https://school-a.localhost:3000/dashboard",
      pathname: "/dashboard",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // StrictMode runs every effect twice: the strictest re-render there is.
  it("marks each announcement seen once when it is on screen, also across re-renders", async () => {
    const { AnnouncementModal } = await setup(true);
    const strict = () => (
      <StrictMode>
        <AnnouncementModal />
      </StrictMode>
    );
    const { rerender } = render(strict());

    await screen.findByText("Erste");
    rerender(strict());
    rerender(strict());
    expect(mocks.markSeen).toHaveBeenCalledTimes(1);
    expect(mocks.markSeen).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await screen.findByText("Zweite");
    rerender(strict());
    expect(mocks.markSeen).toHaveBeenCalledWith(2);
    expect(mocks.markSeen).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failed seen report after its request outcome is ambiguous", async () => {
    mocks.markSeen.mockRejectedValueOnce(
      new Error("vorübergehend nicht erreichbar"),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { AnnouncementModal } = await setup(true);
    render(<AnnouncementModal />);

    await screen.findByText("Erste");
    await waitFor(() => expect(mocks.markSeen).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(mocks.markSeen).toHaveBeenCalledTimes(1);
  });

  it("reports the announcement as shown once and accepted after the last „Verstanden“", async () => {
    const { AnnouncementModal } = await setup(true);
    render(<AnnouncementModal />);

    await waitFor(() => {
      expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_shown", {
        onboarding_surface: "announcement",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await screen.findByText("Zweite");
    expect(surfaceEvents()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Verstanden" }));
    expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_accepted", {
      onboarding_surface: "announcement",
    });
    expect(surfaceEvents()).toHaveLength(2);
  });

  it("reports closing with the X as dismissed", async () => {
    const { AnnouncementModal } = await setup(true);
    render(<AnnouncementModal />);

    fireEvent.click(await screen.findByRole("button", { name: "Schließen" }));
    expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_dismissed", {
      onboarding_surface: "announcement",
    });
    expect(surfaceEvents().map(([event]) => event)).toEqual([
      "onboarding_surface_shown",
      "onboarding_surface_dismissed",
    ]);
  });

  it.each([false, undefined])(
    "sends no browser event while the person's consent is %s, but still marks seen",
    async (consent) => {
      const { AnnouncementModal } = await setup(consent);
      render(<AnnouncementModal />);

      // Anker: die Ankündigung steht da und wird geschlossen.
      await screen.findByText("Erste");
      fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

      // „gesehen“ zählt das Backend für die Schule, ohne Personenbezug (#7541).
      expect(mocks.markSeen).toHaveBeenCalledWith(1);
      expect(mocks.init).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );
});
