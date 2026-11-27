import { bffJson, type Portal } from "~/lib/bff-fetch";
import type { ContrastPreference } from "~/lib/contrast-preference";
import type { PortalKey } from "~/lib/portal-paths";

/**
 * Die Kontrast-Wahl am Konto (`GET`/`PUT /display-preferences/`). Jedes
 * Portal mit Konto liest und schreibt dieselbe Wahl; nur der Client ruft das.
 * `BFF_PORTAL` nennt den BFF-Schlüssel jedes dieser Portale.
 */
const BFF_PORTAL = {
  tenant: "tenant",
  parent: "parent",
  school: "school",
  caterer: "caterer",
  traeger: "org",
  operator: "platform",
} as const satisfies Record<PortalKey, Portal>;

const READ_ERROR = "Die Kontrast-Einstellung konnte nicht geladen werden.";
const SAVE_ERROR = "Die Kontrast-Einstellung konnte nicht gespeichert werden.";

/** Die Wahl des Kontos; null: nicht gewählt. */
export async function readAccountContrast(
  portal: PortalKey,
): Promise<boolean | null> {
  const answer = await bffJson(
    BFF_PORTAL[portal],
    "GET /display-preferences/",
    {
      errorMessage: READ_ERROR,
    },
  );
  return answer.moreContrast;
}

/** Speichert die Wahl am Konto und gibt sie so zurück, wie sie gespeichert ist. */
export async function storeAccountContrast(
  portal: PortalKey,
  moreContrast: boolean,
): Promise<boolean | null> {
  const answer = await bffJson(
    BFF_PORTAL[portal],
    "PUT /display-preferences/",
    {
      body: { moreContrast },
      errorMessage: SAVE_ERROR,
    },
  );
  return answer.moreContrast;
}

/** Die Darstellung, die zur gespeicherten Wahl des Kontos gehört. */
export function contrastOfAccount(
  moreContrast: boolean | null,
): ContrastPreference | undefined {
  if (moreContrast === null) return undefined;
  return moreContrast ? "more" : "normal";
}
