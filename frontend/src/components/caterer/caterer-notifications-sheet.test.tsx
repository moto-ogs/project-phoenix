import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { closeNotificationsSheet } from "~/components/dashboard/header/notifications-sheet-state";

// Das Blatt der Glocke auf dem Telefon im Caterer-Portal (#7147): die Glocke
// öffnet es, ein Klick auf einen Hinweis und das X schließen es.

vi.mock("~/lib/hooks/use-media-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/hooks/use-media-query")>();
  return {
    ...actual,
    useMediaQuery: (query: string) => query === actual.BELOW_SM,
  };
});

vi.mock("~/lib/hooks/use-notification-feed", () => ({
  useNotificationFeedUnread: () => ({
    unreadCount: 2,
    setUnreadCount: vi.fn(),
  }),
}));

vi.mock(
  "~/components/dashboard/header/notification-feed-panel-content",
  () => ({
    NotificationFeedPanelContent: ({
      onNavigate,
    }: Readonly<{ onNavigate: () => void }>) => (
      <button type="button" onClick={onNavigate}>
        Speiseplan geändert
      </button>
    ),
  }),
);

import { NotificationFeedBell } from "~/components/dashboard/header/notification-feed-bell";
import { CatererNotificationsSheet } from "./caterer-notifications-sheet";

function renderPhone() {
  return render(
    <>
      <NotificationFeedBell />
      <CatererNotificationsSheet />
    </>,
  );
}

beforeEach(() => {
  closeNotificationsSheet();
});

describe("Blatt der Glocke im Caterer-Portal", () => {
  it("bleibt zu, bis die Glocke auf dem Telefon es öffnet", async () => {
    renderPhone();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "2 Benachrichtigungen" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Benachrichtigungen",
    });
    expect(dialog).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Speiseplan geändert" }),
    ).toBeInTheDocument();
  });

  it("schließt nach dem Klick auf einen Hinweis", async () => {
    renderPhone();
    fireEvent.click(
      screen.getByRole("button", { name: "2 Benachrichtigungen" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Speiseplan geändert" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("schließt über das X", async () => {
    renderPhone();
    fireEvent.click(
      screen.getByRole("button", { name: "2 Benachrichtigungen" }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Schließen" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
