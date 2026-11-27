"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function readStoredGroups<K extends string>(
  storageKey: string,
  knownKeys: ReadonlySet<string>,
): readonly K[] | null {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (value): value is K => typeof value === "string" && knownKeys.has(value),
    );
  } catch {
    // Unreadable or corrupt entry: fall back to the default groups.
    return null;
  }
}

function writeStoredGroups(storageKey: string, groups: readonly string[]) {
  try {
    globalThis.localStorage.setItem(storageKey, JSON.stringify(groups));
  } catch {
    // Ohne Speicher (privater Modus, volle Quota) gilt der Zustand nur für
    // diese Sitzung.
  }
}

type Listener = (groups: readonly string[]) => void;

/**
 * Jede eingehängte Instanz mit demselben Speicherschlüssel hört hier mit
 * (Seitenleiste und Mehr-Menü der OGS-App, #7048). Beide hängen gleichzeitig
 * ein, auch wenn je nach Breite nur eine zu sehen ist; ohne Abgleich schriebe
 * die eine später ihren veralteten Stand zurück.
 */
const listenersByKey = new Map<string, Set<Listener>>();

function listenersFor(storageKey: string): Set<Listener> {
  let listeners = listenersByKey.get(storageKey);
  if (!listeners) {
    listeners = new Set();
    listenersByKey.set(storageKey, listeners);
  }
  return listeners;
}

function withGroup<K extends string>(
  groups: readonly K[],
  group: K | null,
): readonly K[] {
  if (!group || groups.includes(group)) return groups;
  return [...groups, group];
}

export interface StoredOpenGroupsOptions<K extends string> {
  /** Der Schlüssel im localStorage; jedes Portal hat seinen eigenen. */
  readonly storageKey: string;
  /** Alle Gruppen, die es gibt; Unbekanntes im Speicher fällt weg. */
  readonly knownKeys: ReadonlySet<string>;
  /** Die Gruppe der aktuellen Seite, `null` außerhalb jeder Gruppe. */
  readonly currentGroup: K | null;
  /** Die beim ersten Besuch offenen Gruppen. */
  readonly defaultGroups: readonly K[];
}

/**
 * Welche Gruppen einer Seitenleiste offen stehen (#2826, Träger-Portal #7647).
 *
 * Mehrere Gruppen können gleichzeitig offen sein; jede klappt unabhängig.
 * Beim ersten Besuch stehen `defaultGroups` offen. Was die Person auf- oder
 * zuklappt, merkt sich der Browser unter `storageKey`. Die Gruppe der
 * aktuellen Seite öffnet sich von selbst, ohne die anderen zu schließen; ein
 * Seitenwechsel schließt nichts — sonst müsste man nach jedem Klick wieder
 * aufklappen, was man gerade gebraucht hat.
 *
 * Der erste Render kennt den Speicher nicht (Server und Client müssen
 * dasselbe Bild liefern), deshalb wird der gespeicherte Stand erst nach dem
 * Einhängen übernommen — dasselbe Muster wie useSidebarAccordion.
 *
 * Alle eingehängten Instanzen mit demselben `storageKey` teilen einen Stand.
 *
 * Geschrieben wird nur bei einer echten Änderung (Klick, Auto-Aufklappen,
 * Übernahme des Speichers), nie aus einem Effekt, der den Zustand
 * beobachtet: der liefe beim Einhängen mit dem Standard los und überschriebe
 * den gespeicherten Stand, bevor er gelesen ist (Reacts doppeltes Einhängen
 * im Entwicklungsmodus macht genau das sichtbar).
 */
export function useStoredOpenGroups<K extends string>({
  storageKey,
  knownKeys,
  currentGroup,
  defaultGroups,
}: StoredOpenGroupsOptions<K>) {
  const [openGroups, setOpenGroups] = useState<readonly K[]>(() =>
    withGroup(defaultGroups, currentGroup),
  );
  // Der jeweils letzte Stand, auch zwischen zwei Renderings: die Effekte
  // unten dürfen nicht auf einem veralteten `openGroups` aufsetzen.
  const latest = useRef(openGroups);

  const apply = useCallback(
    (next: readonly K[]) => {
      writeStoredGroups(storageKey, next);
      for (const listener of listenersFor(storageKey)) listener(next);
    },
    [storageKey],
  );

  useEffect(() => {
    const listeners = listenersFor(storageKey);
    const listener: Listener = (next) => {
      // Nur Instanzen desselben Schlüssels melden sich hier.
      const groups = next as readonly K[];
      latest.current = groups;
      setOpenGroups(groups);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [storageKey]);

  useEffect(() => {
    const stored = readStoredGroups<K>(storageKey, knownKeys);
    if (!stored) return;
    // Der gespeicherte Stand ersetzt den Standard; die Gruppe der aktuellen
    // Seite bleibt in jedem Fall offen.
    apply(withGroup(stored, currentGroup));
    // Nur einmal nach dem Einhängen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Die Voreinstellung kann erst nach dem Laden der Sitzung feststehen (Rolle
  // in der OGS-App). Bis die Person selbst etwas auf- oder zugeklappt hat
  // (dann gibt es einen gespeicherten Stand), folgt die Anzeige der
  // Voreinstellung. Geschrieben wird dabei nichts: eine Voreinstellung ist
  // keine Entscheidung der Person.
  const defaultKey = defaultGroups.join(",");
  const isFirstDefault = useRef(true);
  useEffect(() => {
    if (isFirstDefault.current) {
      isFirstDefault.current = false;
      return;
    }
    if (readStoredGroups<K>(storageKey, knownKeys)) return;
    const next = withGroup(defaultGroups, currentGroup);
    latest.current = next;
    setOpenGroups(next);
    // Nur bei einer anderen Voreinstellung, nicht bei jedem Seitenwechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultKey]);

  useEffect(() => {
    if (!currentGroup || latest.current.includes(currentGroup)) return;
    apply(withGroup(latest.current, currentGroup));
  }, [currentGroup, apply]);

  const toggleGroup = useCallback(
    (group: K) => {
      const current = latest.current;
      apply(
        current.includes(group)
          ? current.filter((key) => key !== group)
          : [...current, group],
      );
    },
    [apply],
  );

  const isGroupOpen = useCallback(
    (group: K) => openGroups.includes(group),
    [openGroups],
  );

  return { isGroupOpen, toggleGroup };
}
