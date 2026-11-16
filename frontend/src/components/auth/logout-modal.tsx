"use client";

import { useState } from "react";
import { SignOutIcon } from "@phosphor-icons/react";
import { useShellAuth } from "~/lib/shell-auth-context";
import { DELIBERATE_LOGOUT_KEY } from "~/lib/session-cache";
import { ConfirmationModal } from "~/components/ui/modal";
import { IconTile } from "~/components/ui/icon-tile";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "LogoutModal" });

interface LogoutModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Confirms the logout in the kit's confirmation dialog: named by its title,
 * with a way back, and locked while the logout runs (#7112, #7209).
 */
export function LogoutModal({ isOpen, onClose }: LogoutModalProps) {
  const { logout } = useShellAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true);

    try {
      await logout();
    } catch (error) {
      logger.error("failed to sign out", {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        sessionStorage.removeItem(DELIBERATE_LOGOUT_KEY);
      } catch {
        // sessionStorage unavailable
      }
      setIsLoggingOut(false);
      // The shell showed the failure with a retry (#5194); the modal would
      // cover it. The session stays signed in.
      onClose();
    }
  };

  return (
    <ConfirmationModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={() => void handleConfirmLogout()}
      title="Abmelden"
      icon={<IconTile icon={<SignOutIcon aria-hidden />} size="sm" />}
      confirmText="Abmelden"
      loadingText="Abmeldung läuft …"
      confirmTooltip="Meldet Sie auf diesem Gerät von moto ab."
      isConfirmLoading={isLoggingOut}
      mobileSheet
    >
      <p className="text-sm text-gray-600">
        Möchten Sie sich wirklich von Ihrem Konto abmelden?
      </p>
    </ConfirmationModal>
  );
}
