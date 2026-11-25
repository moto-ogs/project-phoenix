"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Session } from "next-auth";
import { useSession } from "next-auth/react";
import { hasSessionAccess } from "~/lib/session-access";
import {
  bindPersonalStorage,
  clearPersonalStorage,
  leaveForAnotherAccount,
  onOtherTabOwnerChange,
  personalStorageAccount,
  personalStorageOwner,
} from "~/lib/personal-storage";

/**
 * Räumt die personenbezogenen Einträge im Browser-Speicher (#5000), sobald
 * die Sitzung ein anderes Konto oder eine andere Schule trägt oder keine
 * mehr besteht. Deckt damit auch die Wege ohne eigenen Logout-Knopf ab:
 * abgelaufene Sitzung, Anmeldung im falschen Portal, Schulwechsel,
 * Übergabe aus dem Träger-Portal und die Vorschau als andere Person.
 *
 * Eine Seite, die ein Konto gezeigt hat, zeigt nie ein anderes: Wechselt die
 * Sitzung dieses Tabs zu einem anderen Konto, oder bindet ein anderer Tab
 * die Einträge an ein anderes Konto, lädt dieser Tab die Startseite
 * `homeHref()` neu. So überlebt weder ein geladener Zustand (ein Banner, eine
 * Liste) noch eine Adresse mit Filtern des vorigen Kontos. Bleibt das Konto
 * (nur die Schule wechselt, oder dieselbe Person meldet sich wieder an),
 * bleibt die Seite. Nach einem Logout führen die Abmeldewege selbst weiter.
 * Das ist die Grundlage für den Sitzungswechsel über Tabs hinweg, den #5006
 * für den SWR-Cache vervollständigt.
 *
 * Einmal in jedem Portal als erstes Kind des SessionProvider eingehängt;
 * zeichnet nichts. Der Layout-Effekt läuft vor den Effekten der Seiten, die
 * sich etwas merken.
 */
export function PersonalStorageGuard({
  homeHref,
}: {
  /**
   * Start page of the portal; read only when the page has to leave. It gets
   * the new session, or null when another tab changed the account.
   */
  readonly homeHref: (session: Session | null) => string;
}) {
  const { data: session, status } = useSession();
  const owner =
    status === "authenticated" && hasSessionAccess(session)
      ? personalStorageOwner(session.user)
      : null;
  const account = personalStorageAccount(owner);
  // Das Konto, das diese Seite zeigt: das erste, das sie angemeldet sieht.
  const pageAccountRef = useRef<string | null>(null);
  const homeHrefRef = useRef(homeHref);
  const sessionRef = useRef<Session | null>(session ?? null);
  useLayoutEffect(() => {
    homeHrefRef.current = homeHref;
    sessionRef.current = session ?? null;
  }, [homeHref, session]);

  useLayoutEffect(() => {
    // Während die Sitzung lädt, bleibt alles stehen: ein Abruf ist kein
    // Kontowechsel.
    if (status === "loading") return;
    // Eine Seite, deren Sitzungscookie sich seit dem Rendern geändert hat
    // (#8082), bindet nichts: Ihre Sitzung ist nicht mehr die des Browsers,
    // und sie würde die Tabs der neuen Sitzung umbinden.
    if (document.documentElement.hasAttribute("data-session-mark-stale"))
      return;
    if (owner === null) {
      clearPersonalStorage();
      return;
    }
    bindPersonalStorage(owner);
    if (pageAccountRef.current === null) {
      pageAccountRef.current = account;
    } else if (pageAccountRef.current !== account) {
      leaveForAnotherAccount(homeHrefRef.current(sessionRef.current));
    }
  }, [status, owner, account]);

  useEffect(
    () =>
      onOtherTabOwnerChange((nextOwner) => {
        const nextAccount = personalStorageAccount(nextOwner);
        if (
          pageAccountRef.current !== null &&
          nextAccount !== null &&
          nextAccount !== pageAccountRef.current
        ) {
          leaveForAnotherAccount(homeHrefRef.current(null));
        }
      }),
    [],
  );

  return null;
}
