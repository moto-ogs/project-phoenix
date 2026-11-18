"use client";

// Das Vollbild-Blatt der Hinweise auf dem Telefon (#7140). Einmal in der
// Hülle des Elternportals gerendert; der Eintrag „Hinweise“ im Menü „Mehr“
// öffnet es.

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import {
  closeNotificationsSheet,
  useNotificationsSheetOpen,
} from "~/components/dashboard/header/notifications-sheet-state";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "~/components/ui/drawer";

const ParentNotificationsContent = dynamic(
  () =>
    import("./parent-notifications-content").then(
      (module) => module.ParentNotificationsContent,
    ),
  { ssr: false },
);

export function ParentNotificationsSheet() {
  const t = useTranslations("parentNotificationFeed");
  const open = useNotificationsSheetOpen();
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) closeNotificationsSheet();
      }}
    >
      <DrawerContent fullScreen data-testid="parent-notification-sheet">
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-3">
          <DrawerTitle>{t("bell")}</DrawerTitle>
          <DrawerDescription className="sr-only">
            {t("description")}
          </DrawerDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={closeNotificationsSheet}
            aria-label={t("close")}
            tooltip={t("closeTooltip")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain border-t border-gray-100">
          {open ? (
            <ParentNotificationsContent onNavigate={closeNotificationsSheet} />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
