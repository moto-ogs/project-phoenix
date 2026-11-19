import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Einstieg messen (#7556): der Einrichtungs-Dialog meldet über die echte
// Erfassung (Gate für Schule und Einwilligung), nur das SDK und die
// Geräteprüfung sind ersetzt.
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
  fetchPreferences: vi.fn(),
  setPreference: vi.fn(),
  needsIOSInstall: vi.fn(),
  syncSubscription: vi.fn(),
  subscribePush: vi.fn(),
}));

vi.unmock("swr");
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
vi.mock("~/lib/notification-preferences-api", () => ({
  fetchNotificationPreferences: mocks.fetchPreferences,
  setNotificationPreference: mocks.setPreference,
  disableAllNotificationPreferences: vi.fn(),
}));
vi.mock("~/lib/push-api", () => ({
  isPushConfigurationMissing: () => false,
  needsIOSInstall: mocks.needsIOSInstall,
  isPushSupported: () => true,
  syncExistingPushSubscription: mocks.syncSubscription,
  subscribePush: mocks.subscribePush,
  isStandaloneApp: () => false,
}));
vi.mock(
  "~/lib/hooks/use-push-public-key",
  async () => (await import("~/test/push-public-key-mock")).pushPublicKeyModule,
);
vi.mock("~/lib/pwa-install-prompt", () => ({
  isAndroidDevice: () => false,
  isSamsungInternet: () => false,
  canPromptInstall: () => false,
  isInstallationCompleted: () => false,
  subscribeInstallPrompt: () => () => undefined,
  triggerInstallPrompt: vi.fn(),
}));

type Portal = "tenant" | "school" | "parent";

const HOSTS: Record<Portal, string> = {
  tenant: "school-a.localhost:3000",
  school: "schule.localhost:3000",
  parent: "parents.localhost:3000",
};

const SURFACES = { tenant: "ogs", school: "school", parent: "parents" };

function stubHost(portal: Portal) {
  const host = HOSTS[portal];
  vi.stubGlobal("location", {
    ...window.location,
    host,
    hostname: host.replace(/:\d+$/, ""),
    href: `https://${host}/`,
    pathname: "/",
  });
}

/** Lädt Dialog und Erfassung frisch, mit dem gegebenen Stand der Gates. */
async function renderDialog(
  portal: Portal,
  gates: { enabled: boolean; consent: boolean | undefined },
  restartToken = 0,
) {
  const client = await import("~/lib/posthog-client");
  client.setAnalyticsContext({
    surface: SURFACES[portal] as "ogs" | "school" | "parents",
    ...gates,
  });
  await client.initializePostHog();
  const [{ setPushPublicKey }, { SessionProvider }, toast, modal, dialog] =
    await Promise.all([
      import("~/test/push-public-key-mock"),
      import("next-auth/react"),
      import("~/contexts/ToastContext"),
      import("~/components/ui/modal-context"),
      import("./notification-setup-dialog"),
    ]);
  setPushPublicKey("ready");
  return render(
    <SessionProvider
      session={{ user: { id: "1" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <toast.ToastProvider>
        <modal.ModalProvider>
          <dialog.NotificationSetupDialog
            portal={portal}
            accountId="42"
            restartToken={restartToken}
          />
        </modal.ModalProvider>
      </toast.ToastProvider>
    </SessionProvider>,
  );
}

/**
 * Schickt ein erfasstes Ereignis durch den echten `before_send`-Filter, den
 * die Erfassung dem SDK übergibt: so kommt es bei PostHog an.
 */
function delivered(event: string) {
  const options = mocks.init.mock.calls.at(-1)?.[1] as {
    before_send: (result: unknown) => {
      event: string;
      properties: Record<string, unknown>;
    } | null;
  };
  const call = mocks.capture.mock.calls.find(([name]) => name === event);
  return options.before_send({
    uuid: "018f47ac-10b5-7c3d-9d3c-0123456789ab",
    event,
    properties: {
      token: "phc_test_key_123",
      distinct_id: "0199aa2b-anon",
      ...(call?.[1] as object),
    },
  });
}

function surfaceEvents() {
  return mocks.capture.mock.calls.filter(([event]) =>
    String(event).startsWith("onboarding_surface_"),
  );
}

const SURFACE = { onboarding_surface: "notification_setup" };

describe("NotificationSetupDialog analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("requestIdleCallback", vi.fn());
    vi.stubGlobal("Notification", { permission: "default" });
    mocks.needsIOSInstall.mockReturnValue(false);
    mocks.syncSubscription.mockResolvedValue(null);
    mocks.subscribePush.mockResolvedValue(undefined);
    mocks.setPreference.mockResolvedValue(undefined);
    mocks.fetchPreferences.mockResolvedValue({
      tenant_enabled: true,
      types: [
        {
          key: "pickup_upcoming",
          label: "Abholung",
          description: "",
          group: "abholung",
          enabled: false,
          available: true,
        },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["tenant", "school", "parent"] as const)(
    "reports shown and accepted (fertig) in the %s portal",
    async (portal) => {
      stubHost(portal);
      await renderDialog(portal, { enabled: true, consent: true });

      fireEvent.click(
        await screen.findByRole("button", {
          name: "Benachrichtigungen aktivieren",
        }),
      );

      await waitFor(() =>
        expect(mocks.capture).toHaveBeenCalledWith(
          "onboarding_surface_accepted",
          SURFACE,
        ),
      );
      expect(mocks.capture).toHaveBeenCalledWith(
        "onboarding_surface_shown",
        SURFACE,
      );
      expect(surfaceEvents()).toHaveLength(2);
      // Bei PostHog steht das Portal in `surface`, die Fläche fest.
      for (const event of [
        "onboarding_surface_shown",
        "onboarding_surface_accepted",
      ]) {
        expect(delivered(event)?.properties).toMatchObject({
          surface: SURFACES[portal],
          onboarding_surface: "notification_setup",
        });
      }
    },
  );

  it.each(["tenant", "school", "parent"] as const)(
    "reports dismissed (später) in the %s portal",
    async (portal) => {
      stubHost(portal);
      await renderDialog(portal, { enabled: true, consent: true });

      fireEvent.click(
        await screen.findByRole("button", { name: "Später erinnern" }),
      );

      expect(mocks.capture).toHaveBeenCalledWith(
        "onboarding_surface_dismissed",
        SURFACE,
      );
      expect(surfaceEvents()).toEqual([
        ["onboarding_surface_shown", SURFACE],
        ["onboarding_surface_dismissed", SURFACE],
      ]);
    },
  );

  it("reports closing the install guide on iPhone as dismissed", async () => {
    stubHost("tenant");
    mocks.needsIOSInstall.mockReturnValue(true);
    await renderDialog("tenant", { enabled: true, consent: true });

    fireEvent.click(
      await screen.findByRole("button", { name: "Anleitung schließen" }),
    );

    expect(surfaceEvents()).toEqual([
      ["onboarding_surface_shown", SURFACE],
      ["onboarding_surface_dismissed", SURFACE],
    ]);
  });

  it("reports nothing when the person restarts the setup from the settings", async () => {
    stubHost("tenant");
    await renderDialog("tenant", { enabled: true, consent: true }, 1);

    fireEvent.click(
      await screen.findByRole("button", { name: "Später erinnern" }),
    );

    // Anker: die Erfassung läuft, der Dialog ist offen gewesen.
    expect(mocks.init).toHaveBeenCalled();
    expect(surfaceEvents()).toHaveLength(0);
  });

  it.each([
    ["tenant", false],
    ["tenant", undefined],
    ["school", false],
    ["parent", false],
  ] as const)(
    "sends nothing in the %s portal while the consent is %s",
    async (portal, consent) => {
      stubHost(portal);
      await renderDialog(portal, { enabled: true, consent });

      fireEvent.click(
        await screen.findByRole("button", { name: "Später erinnern" }),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      expect(mocks.init).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );

  // Eltern: `enabled` ist nur wahr, wenn alle Schulen der Person die
  // Nutzungsanalyse zulassen (PortalAnalyticsSession). Eine Schule ohne
  // Freigabe hält also auch mit Einwilligung alles zurück.
  it.each(["parent", "school", "tenant"] as const)(
    "sends nothing in the %s portal when the schools do not allow analytics",
    async (portal) => {
      stubHost(portal);
      await renderDialog(portal, { enabled: false, consent: true });

      fireEvent.click(
        await screen.findByRole("button", { name: "Später erinnern" }),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      expect(mocks.init).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );
});
