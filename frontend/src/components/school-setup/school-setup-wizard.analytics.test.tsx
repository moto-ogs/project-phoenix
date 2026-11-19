import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchoolSetupState } from "~/lib/school-setup-api";

// Die Einrichtungs-Checkliste als Fläche des Einstiegs (#7554): sie meldet
// über die echte Erfassung (Gate für Schule und Einwilligung), nur das SDK
// ist ersetzt. Abschließen, Überspringen und Ausblenden zählt das Backend.
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

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuthSafe: () => ({
    user: { id: "73" },
    isPreview: false,
    isViaTraeger: false,
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useNFCEnabled: () => false,
  useTenantSlugSafe: () => "school-a",
}));
vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: vi.fn() }),
}));
vi.mock("./use-school-setup", () => ({
  useSchoolSetup: () => ({
    state: newSchool(),
    accountID: "73",
    refresh: () => Promise.resolve(),
    replace: () => Promise.resolve(),
  }),
}));
vi.mock("~/lib/school-setup-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/school-setup-api")>()),
  setSchoolSetupDismissed: () =>
    Promise.resolve({ ...newSchool(), dismissed: true }),
}));
vi.mock("./use-work-time-coverage", () => ({
  useWorkTimeCoverage: () => ({
    coverage: undefined,
    error: undefined,
    retry: () => Promise.resolve(undefined),
  }),
}));

function newSchool(): SchoolSetupState {
  return {
    completed: false,
    dismissed: false,
    basics: { presenceMode: "detailed", groupMode: "fixed_groups" },
    steps: [
      { key: "team", applies: true, done: false, skipped: false },
      { key: "rooms", applies: true, done: false, skipped: false },
    ],
  };
}

/** Lädt Checkliste und Erfassung frisch, mit dem gegebenen Einwilligungsstand. */
async function setup(consent: boolean | undefined) {
  const client = await import("~/lib/posthog-client");
  client.setAnalyticsContext({ enabled: true, consent });
  await client.initializePostHog();
  const { SchoolSetupWizard } = await import("./school-setup-wizard");
  return { SchoolSetupWizard };
}

function surfaceEvents() {
  return mocks.capture.mock.calls.filter(([event]) =>
    String(event).startsWith("onboarding_surface_"),
  );
}

const CHECKLIST = { onboarding_surface: "setup_checklist" };

describe("SchoolSetupWizard analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports the checklist that opens itself as shown, and its first collapse as dismissed", async () => {
    const { SchoolSetupWizard } = await setup(true);
    render(<SchoolSetupWizard />);

    expect(mocks.capture).toHaveBeenCalledWith(
      "onboarding_surface_shown",
      CHECKLIST,
    );
    fireEvent.click(screen.getByLabelText("Checkliste einklappen"));
    expect(mocks.capture).toHaveBeenCalledWith(
      "onboarding_surface_dismissed",
      CHECKLIST,
    );

    // Selbst wieder geöffnet und eingeklappt: kein weiteres Ereignis.
    fireEvent.click(
      screen.getByRole("button", { name: "Erste Schritte öffnen, 2 offen" }),
    );
    fireEvent.click(screen.getByLabelText("Checkliste einklappen"));
    expect(surfaceEvents()).toHaveLength(2);
  });

  it("reports hiding the checklist that opened itself as dismissed", async () => {
    const { SchoolSetupWizard } = await setup(true);
    render(<SchoolSetupWizard />);

    fireEvent.click(
      screen.getByRole("button", { name: "Nicht mehr anzeigen" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ausblenden" }));
    await waitFor(() => {
      expect(mocks.capture).toHaveBeenCalledWith(
        "onboarding_surface_dismissed",
        CHECKLIST,
      );
    });
    expect(surfaceEvents()).toHaveLength(2);
  });

  it("reports nothing when the checklist already opened itself in this session", async () => {
    sessionStorage.setItem("school-setup-opened:school-a:73", "1");
    const { SchoolSetupWizard } = await setup(true);
    render(<SchoolSetupWizard />);

    fireEvent.click(
      screen.getByRole("button", { name: "Erste Schritte öffnen, 2 offen" }),
    );
    fireEvent.click(screen.getByLabelText("Checkliste einklappen"));
    expect(surfaceEvents()).toHaveLength(0);
  });

  it.each([false, undefined])(
    "sends nothing while the person's consent is %s",
    async (consent) => {
      const { SchoolSetupWizard } = await setup(consent);
      render(<SchoolSetupWizard />);

      // Anker: die Checkliste stand offen und wurde eingeklappt.
      fireEvent.click(screen.getByLabelText("Checkliste einklappen"));
      expect(
        screen.getByRole("button", { name: "Erste Schritte öffnen, 2 offen" }),
      ).toBeInTheDocument();

      expect(mocks.init).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );
});
