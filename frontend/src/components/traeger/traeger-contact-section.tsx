"use client";

import { useSession } from "next-auth/react";
import { Alert } from "~/components/ui/alert";
import { hasPermission } from "~/lib/auth-utils";
import type { TraegerMasterData } from "~/lib/traeger-api";
import { TraegerContactCard } from "./traeger-contact-card";
import { TraegerWithdrawalContactCard } from "./traeger-withdrawal-contact-card";

/** The Träger right that changes the master data (ADR 0084 section 4). */
const SETTINGS_RIGHT = "traeger_settings:manage";

/**
 * Die Ansprechperson des Trägers und sein Kontakt für Widerrufe im Bereich
 * „Kontakt“ unter „Allgemein“ (#5685, #6200). Liest die Stammdaten erst beim
 * Öffnen des Bereichs: Jedes Lesen steht im Protokoll des Trägers.
 */
export function TraegerContactSection({
  masterData,
  letterheadText,
  refreshLetterhead,
  reload,
  write,
  onSaved,
}: Readonly<{
  masterData: Pick<
    TraegerMasterData,
    "contact" | "withdrawal" | "contactVersion" | "withdrawalVersion"
  >;
  /** Der Absender aus dem Briefkopf; die Belehrung nennt ihn mit Anschrift. */
  letterheadText: string;
  /** Liest den Briefkopf neu, wenn jemand aus seinem Tab zurückkommt. */
  refreshLetterhead: () => Promise<unknown>;
  /** Liest die Stammdaten nach einer Ablehnung neu; scheitert laut. */
  reload: () => Promise<TraegerMasterData>;
  /** Übernimmt die Antwort eines Speicherns in die gelesenen Stammdaten. */
  write: (change: Partial<TraegerMasterData>) => Promise<unknown>;
  onSaved: () => Promise<unknown>;
}>) {
  const { data: session } = useSession();
  const canEdit = hasPermission(session ?? null, SETTINGS_RIGHT);
  return (
    <>
      {canEdit ? null : (
        <Alert
          type="info"
          message="Du kannst die Angaben nur ansehen. Ändern kann, wer im Träger-Büro die Rolle „Verwaltung“ hat."
        />
      )}
      <TraegerContactCard
        contact={masterData.contact}
        version={masterData.contactVersion}
        canEdit={canEdit}
        reload={async () => {
          const read = await reload();
          return { value: read.contact, version: read.contactVersion };
        }}
        write={(saved) =>
          write({ contact: saved.value, contactVersion: saved.version })
        }
        onSaved={onSaved}
      />
      <TraegerWithdrawalContactCard
        withdrawal={masterData.withdrawal}
        version={masterData.withdrawalVersion}
        reload={async () => {
          const read = await reload();
          return { value: read.withdrawal, version: read.withdrawalVersion };
        }}
        write={(saved) =>
          write({ withdrawal: saved.value, withdrawalVersion: saved.version })
        }
        contact={masterData.contact}
        letterheadText={letterheadText}
        refreshLetterhead={refreshLetterhead}
        canEdit={canEdit}
        onSaved={onSaved}
      />
    </>
  );
}
