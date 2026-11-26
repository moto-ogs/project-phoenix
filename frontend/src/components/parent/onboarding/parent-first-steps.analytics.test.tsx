import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parentFirstStepsStorageKey } from "./parent-first-steps-state";

// Erste Schritte der Eltern (#7557): die Liste meldet über die echte Erfassung
// (Gate für Schule und Einwilligung), nur das SDK ist ersetzt.
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
}));

vi.mock("~/env.client", () => ({ clientEnv: mocks.env }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
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

const SURFACE = { onboarding_surface: "parent_first_steps" };
const CHECKLIST = { checklist: "parent_first_steps" };

/** Lädt Liste und Erfassung frisch, mit dem gegebenen Einwilligungsstand. */
async function renderFirstSteps(consent: boolean | undefined) {
  const client = await import("~/lib/posthog-client");
  client.setAnalyticsContext({ enabled: true, consent });
  await client.initializePostHog();
  const { ParentFirstSteps } = await import("./parent-first-steps");
  render(<ParentFirstSteps accountId="42" childCount={1} newsEnabled />);
  await screen.findByRole("heading", { name: "Erste Schritte" });
}

function onboardingEvents() {
  return mocks.capture.mock.calls.filter(([event]) =>
    String(event).startsWith("onboarding_"),
  );
}

function openInstallGuide() {
  fireEvent.click(
    screen.getByRole("button", {
      name: "moto als App auf dem Handy hinzufügen",
    }),
  );
  const guide = screen.getByRole("link", { name: "Anleitung öffnen" });
  guide.addEventListener("click", (event) => event.preventDefault(), {
    once: true,
  });
  fireEvent.click(guide);
}

describe("ParentFirstSteps analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("requestIdleCallback", vi.fn());
    vi.stubGlobal("location", {
      ...window.location,
      host: "parents.localhost:3000",
      hostname: "parents.localhost",
      href: "https://parents.localhost:3000/",
      pathname: "/",
    });
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the self-opening list and each newly done step once", async () => {
    await renderFirstSteps(true);

    await waitFor(() => {
      expect(mocks.capture).toHaveBeenCalledWith(
        "onboarding_surface_shown",
        SURFACE,
      );
    });
    openInstallGuide();
    expect(mocks.capture).toHaveBeenCalledWith(
      "onboarding_surface_accepted",
      SURFACE,
    );
    expect(mocks.capture).toHaveBeenCalledWith(
      "onboarding_checklist_step_done",
      { ...CHECKLIST, checklist_step: "install_app" },
    );

    // Ein schon erledigter Schritt und das Zuklappen nach der Antwort zählen
    // nicht noch einmal.
    fireEvent.click(screen.getByRole("link", { name: "Anleitung öffnen" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Erste Schritte einklappen" }),
    );
    expect(onboardingEvents()).toHaveLength(3);
  });

  it("reports closing the list and hiding the checklist", async () => {
    await renderFirstSteps(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Erste Schritte einklappen" }),
    );
    expect(mocks.capture).toHaveBeenCalledWith(
      "onboarding_surface_dismissed",
      SURFACE,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /^Erste Schritte \d+$/,
        description: /Erste Schritte öffnen/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Erste Schritte ausblenden" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ausblenden" }));
    expect(mocks.capture).toHaveBeenCalledWith(
      "onboarding_checklist_dismissed",
      CHECKLIST,
    );
    expect(onboardingEvents().map(([event]) => event)).toEqual([
      "onboarding_surface_shown",
      "onboarding_surface_dismissed",
      "onboarding_checklist_dismissed",
    ]);
  });

  it("counts no answer when the list opened before collection was allowed", async () => {
    const client = await import("~/lib/posthog-client");
    // Die Schulfreigabe der Eltern ist beim Öffnen noch nicht geladen.
    client.setAnalyticsContext({ enabled: false, consent: true });
    const { ParentFirstSteps } = await import("./parent-first-steps");
    render(<ParentFirstSteps accountId="42" childCount={1} newsEnabled />);
    await screen.findByRole("heading", { name: "Erste Schritte" });

    client.setAnalyticsContext({ enabled: true });
    await client.initializePostHog();
    fireEvent.click(
      screen.getByRole("button", { name: "Erste Schritte einklappen" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Erste Schritte \d+$/,
        description: /Erste Schritte öffnen/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Erste Schritte ausblenden" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ausblenden" }));

    // Die Checkliste meldet weiter; nur die Fläche bleibt ohne Antwort.
    expect(onboardingEvents().map(([event]) => event)).toEqual([
      "onboarding_checklist_dismissed",
    ]);
  });

  it("reports completing the checklist", async () => {
    localStorage.setItem(
      parentFirstStepsStorageKey("42"),
      JSON.stringify({
        completed: [
          "start",
          "childData",
          "messagesNews",
          "installApp",
          "notifications",
        ],
        dismissed: false,
        finished: false,
      }),
    );
    await renderFirstSteps(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Erste Schritte abschließen" }),
    );
    expect(mocks.capture).toHaveBeenCalledWith(
      "onboarding_checklist_completed",
      CHECKLIST,
    );
  });

  it.each([false, undefined])(
    "sends nothing while the person's consent is %s",
    async (consent) => {
      await renderFirstSteps(consent);

      openInstallGuide();
      fireEvent.click(
        screen.getByRole("button", { name: "Erste Schritte ausblenden" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Ausblenden" }));
      // Anker: die Liste wurde bedient und ist ausgeblendet.
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "Erste Schritte" }),
        ).not.toBeInTheDocument(),
      );

      expect(mocks.init).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );
});
