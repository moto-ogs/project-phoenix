import type { StatusBadgeTone } from "~/components/ui/status-badge";
import type {
  DeclarationAction,
  DeclarationChildState,
} from "~/lib/parent-announcements-api";

// Wording and tone of an Einverständnis per child (#3430), shared by the
// status of the Einverständnis and the child's Dokumente tab (#4814), so
// both say the same about the same child.

/**
 * State of one child for the CURRENT version (#3430). Declined and revoked
 * share the red tone on purpose: both mean „keine Zustimmung", the label
 * tells them apart. No-signer and expired share gray: nothing more can
 * happen for that child without the school.
 */
export const DECLARATION_STATE_META: Record<
  DeclarationChildState,
  { label: string; tone: StatusBadgeTone; title?: string }
> = {
  open: { label: "Offen", tone: "warning" },
  partial: {
    label: "Teilweise beantwortet",
    tone: "blue",
    title:
      "Einige, aber noch nicht alle sorgeberechtigten Personen haben geantwortet.",
  },
  agreed: { label: "Zugestimmt", tone: "green" },
  declined: { label: "Abgelehnt", tone: "red" },
  revoked: { label: "Widerrufen", tone: "red" },
  no_signer: {
    label: "Niemand kann antworten",
    tone: "gray",
    title:
      "Keine sorgeberechtigte Person dieses Kindes hat ein Eltern-Konto. Eine Erinnerung ändert daran nichts.",
  },
  expired: { label: "Frist abgelaufen", tone: "gray" },
};

export const DECLARATION_ACTION_LABEL: Record<DeclarationAction, string> = {
  agreed: "Zugestimmt",
  declined: "Abgelehnt",
  revoked: "Widerrufen",
};
