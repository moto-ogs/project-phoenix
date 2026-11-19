import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Selbstöffnende Flächen des Einstiegs (#7552): der Hinweis meldet über die
// echte Erfassung (Gate für Schule und Einwilligung), nur das SDK ist ersetzt.
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

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36";
const SAMSUNG_INTERNET_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36";

function stubDevice(userAgent: string) {
  vi.stubGlobal("navigator", {
    userAgent,
    platform: userAgent === IPHONE_UA ? "iPhone" : "Linux armv81",
    maxTouchPoints: 5,
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

/** Zweiter Besuch: erst dann zeigt sich der Hinweis. */
function seedReturningVisitor() {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("moto-pwa-install-hint-visits", "1");
}

/** Lädt Hinweis und Erfassung frisch, mit dem gegebenen Einwilligungsstand. */
async function setup(consent: boolean | undefined) {
  const client = await import("~/lib/posthog-client");
  client.setAnalyticsContext({ enabled: true, consent });
  await client.initializePostHog();
  const { PwaInstallHint } = await import("./pwa-install-hint");
  return { PwaInstallHint };
}

function surfaceEvents() {
  return mocks.capture.mock.calls.filter(([event]) =>
    String(event).startsWith("onboarding_surface_"),
  );
}

describe("PwaInstallHint analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
    seedReturningVisitor();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports the Samsung hint as its own surface: shown, accepted, dismissed", async () => {
    stubDevice(SAMSUNG_INTERNET_UA);
    const { PwaInstallHint } = await setup(true);
    render(<PwaInstallHint samsungOnly />);

    await waitFor(() => {
      expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_shown", {
        onboarding_surface: "samsung_hint",
      });
    });
    fireEvent.click(screen.getByRole("link", { name: "In Chrome öffnen" }));
    expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_accepted", {
      onboarding_surface: "samsung_hint",
    });
    fireEvent.click(screen.getByLabelText("Hinweis schließen"));
    expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_dismissed", {
      onboarding_surface: "samsung_hint",
    });
    expect(surfaceEvents()).toHaveLength(3);
    // Die Karte meldet weiter das bisherige Ereignis (#2189).
    expect(mocks.capture).toHaveBeenCalledWith(
      "pwa_install_prompt_shown",
      undefined,
    );
  });

  it("reports the install hint on iOS and Android as install_hint", async () => {
    stubDevice(IPHONE_UA);
    const { PwaInstallHint } = await setup(true);
    render(<PwaInstallHint />);

    await waitFor(() => {
      expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_shown", {
        onboarding_surface: "install_hint",
      });
    });
    fireEvent.click(screen.getByLabelText("Hinweis schließen"));
    expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_dismissed", {
      onboarding_surface: "install_hint",
    });
    expect(surfaceEvents()).toHaveLength(2);
  });

  it("reports a tap on one-tap install as accepted", async () => {
    stubDevice(ANDROID_UA);
    const { PwaInstallHint } = await setup(true);
    const prompt = vi.fn().mockResolvedValue(undefined);
    window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt"), {
        prompt,
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      }),
    );
    render(<PwaInstallHint />);

    fireEvent.click(
      await screen.findByRole("button", { name: "App installieren" }),
    );
    expect(mocks.capture).toHaveBeenCalledWith("onboarding_surface_accepted", {
      onboarding_surface: "install_hint",
    });
    // Die Antwort im Browser-Dialog bleibt beim bisherigen Ereignis.
    await waitFor(() => {
      expect(mocks.capture).toHaveBeenCalledWith(
        "pwa_install_prompt_dismissed",
        undefined,
      );
    });
    expect(surfaceEvents()).toHaveLength(2);
  });

  it.each([false, undefined])(
    "sends nothing while the person's consent is %s",
    async (consent) => {
      stubDevice(SAMSUNG_INTERNET_UA);
      const { PwaInstallHint } = await setup(consent);
      render(<PwaInstallHint samsungOnly />);

      // Anker: die Karte steht da und wird bedient.
      fireEvent.click(screen.getByRole("link", { name: "In Chrome öffnen" }));
      fireEvent.click(screen.getByLabelText("Hinweis schließen"));
      expect(screen.queryByText("moto als App nutzen")).not.toBeInTheDocument();

      expect(mocks.init).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );
});
