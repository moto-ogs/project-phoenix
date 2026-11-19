import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "~/i18n/messages/en.generated";
import { messageLoaders } from "~/i18n/messages/loaders.generated";
import {
  NotificationPreferencesSection,
  PARENT_TYPES,
} from "./notification-preferences-section";
import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");

// Real SWR with a fresh cache and a signed-in session per render; the shared
// error path shows failures through the toast provider (#2517).
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1", scope: "tenant" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    </SessionProvider>
  );
}

function renderWithToast(
  ui: Parameters<typeof render>[0],
  options?: Parameters<typeof render>[1],
) {
  return render(ui, { wrapper: Providers, ...options });
}

const api = vi.hoisted(() => ({
  fetchNotificationPreferences: vi.fn(),
  setNotificationPreference: vi.fn(),
  disableAllNotificationPreferences: vi.fn(),
}));

vi.mock("~/lib/notification-preferences-api", () => api);
vi.mock("next-intl", () => ({
  useTranslations: (namespace: keyof typeof en) => {
    const messages = en[namespace] as Record<string, unknown>;
    return (key: string, values?: Record<string, unknown>) =>
      (
        key.split(".").reduce<unknown>((value, part) => {
          if (value && typeof value === "object") {
            return (value as Record<string, unknown>)[part];
          }
          return undefined;
        }, messages) as string
      ).replace(/\{(\w+)\}/g, (match, name: string) =>
        values && name in values ? String(values[name]) : match,
      );
  },
}));

describe("parent notification preference translations", () => {
  beforeEach(() => {
    api.fetchNotificationPreferences.mockResolvedValue({
      tenant_enabled: true,
      types: [
        {
          key: "parent_message",
          label: "Neue Nachricht der OGS",
          description: "Wenn die OGS zu einem Kind schreibt.",
          group: "mitteilungen",
          enabled: false,
          available: true,
        },
      ],
    });
  });

  it("renders parent labels from the active catalog instead of backend German", async () => {
    renderWithToast(<NotificationPreferencesSection portal="parent" />);

    // Der Titel steht schon im Ladezustand da, die Gruppen erst nach dem Laden.
    // Deshalb auf die Gruppe selbst warten (#6320).
    expect(await screen.findByText("Notifications")).toBeVisible();
    expect(await screen.findByText("Messages")).toBeVisible();
    expect(
      screen.getByRole("switch", { name: "New message from the OGS" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Neue Nachricht der OGS"),
    ).not.toBeInTheDocument();
  });
});

// A parent type without its texts shows a raw key in the parents' settings
// (parent_class_timetable_changed, #7142).
describe("every parent notification type has its texts in every language", () => {
  it.each(Object.keys(messageLoaders) as Array<keyof typeof messageLoaders>)(
    "%s",
    async (locale) => {
      const { default: messages } = await messageLoaders[locale]();
      const types = (
        messages.notificationPreferences as {
          types: Record<string, { label?: string; description?: string }>;
        }
      ).types;
      for (const key of PARENT_TYPES) {
        expect(types[key]?.label, `${locale} ${key}.label`).toBeTruthy();
        expect(
          types[key]?.description,
          `${locale} ${key}.description`,
        ).toBeTruthy();
      }
    },
  );
});
