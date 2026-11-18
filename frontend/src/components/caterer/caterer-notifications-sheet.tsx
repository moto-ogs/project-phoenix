"use client";

// Das Blatt der Glocke auf dem Telefon im Caterer-Portal (#7147). Bewusst
// das `Modal` des Kits als Blatt von unten statt des Vaul-Drawers der anderen
// Portale: das Modal lädt jede Caterer-Seite ohnehin, der Drawer kostete jede
// Caterer-Route rund 23 KB. Die Glocke öffnet es über
// `useOpenNotificationsSheet`; geschlossen wird über X, Hintergrund, Escape
// oder einen Klick auf einen Hinweis.

import dynamic from "next/dynamic";

import {
  closeNotificationsSheet,
  useNotificationsSheetOpen,
} from "~/components/dashboard/header/notifications-sheet-state";
import { Modal } from "~/components/ui/modal";

const NotificationFeedPanelContent = dynamic(
  () =>
    import("~/components/dashboard/header/notification-feed-panel-content").then(
      (module) => module.NotificationFeedPanelContent,
    ),
  { ssr: false },
);

export function CatererNotificationsSheet() {
  const open = useNotificationsSheetOpen();
  return (
    <Modal
      isOpen={open}
      onClose={closeNotificationsSheet}
      title="Benachrichtigungen"
      closeLabel="Schließen"
      closeTooltip="Schließt die Benachrichtigungen."
      mobileSheet
    >
      {open ? (
        <div data-testid="notification-sheet">
          <NotificationFeedPanelContent onNavigate={closeNotificationsSheet} />
        </div>
      ) : null}
    </Modal>
  );
}
