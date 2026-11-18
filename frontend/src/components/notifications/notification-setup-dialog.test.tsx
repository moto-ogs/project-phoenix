import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_PUSH_PUBLIC_KEY,
  setPushPublicKey,
} from "~/test/push-public-key-mock";
import { ModalProvider } from "~/components/ui/modal-context";
import {
  NotificationSetupDialog,
  setupStorageKey,
} from "./notification-setup-dialog";
import { ToastProvider } from "~/contexts/ToastContext";

// The shared error path shows failures through the toast provider (#2517);
// the component refreshes the scoped cache, which needs the session.
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}

function renderWithToast(
  ui: Parameters<typeof render>[0],
  options?: Parameters<typeof render>[1],
) {
  return render(ui, { wrapper: Providers, ...options });
}

const mocks = vi.hoisted(() => ({
  fetchPreferences: vi.fn(),
  setPreference: vi.fn(),
  needsIOSInstall: vi.fn(),
  isPushSupported: vi.fn(),
  syncSubscription: vi.fn(),
  subscribePush: vi.fn(),
  isStandaloneApp: vi.fn(),
  isAndroidDevice: vi.fn(),
  isSamsungInternet: vi.fn(),
  canPromptInstall: vi.fn(),
  isInstallationCompleted: vi.fn(),
  triggerInstallPrompt: vi.fn(),
}));

vi.mock("~/lib/notification-preferences-api", () => ({
  fetchNotificationPreferences: mocks.fetchPreferences,
  setNotificationPreference: mocks.setPreference,
}));

vi.mock("~/lib/push-api", () => ({
  isPushConfigurationMissing: () => false,
  needsIOSInstall: mocks.needsIOSInstall,
  isPushSupported: mocks.isPushSupported,
  syncExistingPushSubscription: mocks.syncSubscription,
  subscribePush: mocks.subscribePush,
  isStandaloneApp: mocks.isStandaloneApp,
}));

vi.mock(
  "~/lib/hooks/use-push-public-key",
  async () => (await import("~/test/push-public-key-mock")).pushPublicKeyModule,
);
vi.mock("~/lib/pwa-install-prompt", () => ({
  isAndroidDevice: mocks.isAndroidDevice,
  isSamsungInternet: mocks.isSamsungInternet,
  canPromptInstall: mocks.canPromptInstall,
  isInstallationCompleted: mocks.isInstallationCompleted,
  subscribeInstallPrompt: () => () => undefined,
  triggerInstallPrompt: mocks.triggerInstallPrompt,
}));

function renderDialog(props: {
  portal: "tenant" | "parent" | "school";
  restartToken?: number;
}) {
  return renderWithToast(
    <ModalProvider>
      <NotificationSetupDialog accountId="42" {...props} />
    </ModalProvider>,
  );
}

describe("NotificationSetupDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("Notification", { permission: "default" });
    mocks.needsIOSInstall.mockReturnValue(false);
    mocks.isPushSupported.mockReturnValue(true);
    mocks.syncSubscription.mockResolvedValue(null);
    mocks.subscribePush.mockResolvedValue(undefined);
    setPushPublicKey("ready");
    mocks.isStandaloneApp.mockReturnValue(false);
    mocks.isAndroidDevice.mockReturnValue(false);
    mocks.isSamsungInternet.mockReturnValue(false);
    mocks.canPromptInstall.mockReturnValue(false);
    mocks.isInstallationCompleted.mockReturnValue(false);
    mocks.triggerInstallPrompt.mockResolvedValue("accepted");
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

  it("keeps the parents storage key so an earlier decision still counts", () => {
    expect(setupStorageKey("parent", "42")).toBe(
      "moto.parent.notification-setup.v1.42",
    );
  });

  it("scopes a staff setup decision to the active tenant", () => {
    expect(setupStorageKey("tenant", "42", "school-a")).toBe(
      "moto.tenant.notification-setup.v1.school-a.42",
    );
  });

  it("asks staff about their own device, not about a child", async () => {
    renderDialog({ portal: "tenant" });

    expect(
      await screen.findByText(
        "Schalte Benachrichtigungen ein. moto meldet sich dann bei wichtigen Ereignissen, auch wenn die App geschlossen ist.",
      ),
    ).toBeInTheDocument();
  });

  it("reads the school portal's own preferences and subscription", async () => {
    renderDialog({ portal: "school" });

    await waitFor(() =>
      expect(mocks.fetchPreferences).toHaveBeenCalledWith("school"),
    );
    expect(mocks.syncSubscription).toHaveBeenCalledWith(
      "school",
      TEST_PUSH_PUBLIC_KEY,
    );
  });

  it("explains the home-screen step first on iPhone and iPad", async () => {
    mocks.needsIOSInstall.mockReturnValue(true);

    renderDialog({ portal: "tenant" });

    expect(
      await screen.findByRole("heading", {
        name: "moto zum Home-Bildschirm hinzufügen",
      }),
    ).toBeInTheDocument();
  });

  it("stays closed once this browser finished the setup", async () => {
    localStorage.setItem(
      setupStorageKey("tenant", "42", "test-tenant"),
      JSON.stringify({ done: true }),
    );

    const { unmount } = renderDialog({ portal: "tenant" });

    await waitFor(() => expect(mocks.fetchPreferences).not.toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();

    localStorage.clear();
    renderDialog({ portal: "tenant" });
    // Anker: ohne gespeicherten Abschluss öffnet sich derselbe Dialog.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("runs again when the settings card restarts the setup", async () => {
    localStorage.setItem(
      setupStorageKey("tenant", "42", "test-tenant"),
      JSON.stringify({ done: true }),
    );

    renderDialog({ portal: "tenant", restartToken: 1 });

    await waitFor(() =>
      expect(mocks.fetchPreferences).toHaveBeenCalledWith("tenant"),
    );
  });

  it("waits for tenant preferences after Android installation", async () => {
    mocks.isAndroidDevice.mockReturnValue(true);
    mocks.canPromptInstall.mockReturnValue(true);
    let resolvePreferences: ((value: unknown) => void) | undefined;
    mocks.fetchPreferences.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreferences = resolve;
        }),
    );

    renderDialog({ portal: "tenant" });

    fireEvent.click(
      await screen.findByRole("button", { name: "App installieren" }),
    );
    await waitFor(() =>
      expect(mocks.triggerInstallPrompt).toHaveBeenCalledOnce(),
    );

    expect(
      screen.queryByRole("button", { name: "Benachrichtigungen aktivieren" }),
    ).not.toBeInTheDocument();

    resolvePreferences?.({ tenant_enabled: false, types: [] });
    await waitFor(() => expect(mocks.fetchPreferences).toHaveBeenCalledOnce());
    expect(mocks.subscribePush).not.toHaveBeenCalled();
  });
});
