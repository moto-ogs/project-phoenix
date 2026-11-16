---
status: proposed
---

# Glocke im Elternportal liest den Feed des Kontos in einem Admin-Rahmen

Vorschlag vom 16.11.2026 zu
[#7140](https://github.com/moto-ogs/project-phoenix/issues/7140), Teil der Spec
in [#7127](https://github.com/moto-ogs/project-phoenix/issues/7127). Er folgt
[ADR 0161](0161-gleiche-transaktionsrahmen-werden-gebuendelt-admin-geht-nur-einseitig-in-den-tenant.md)
und führt keinen neuen Owner und keine neue Tabelle ein.

## Kontext

Der Benachrichtigungs-Feed gehört Delivery (#7148). Ein Eintrag gehört einem
Konto in einer Schule, `platform.notification_feed_entries` steht unter RLS
pro Schule. Im Staff-Portal liest der Feed im Tenant-Rahmen der Sitzung.

Das Elternportal hat keine Schule der Sitzung: Ein Elternkonto gehört zu allen
Schulen seiner Kinder, wie Elternbriefe, Präferenzen und Push-Geräte. Die Spec
verlangt für Eltern-Einträge, dass jedes Lesen neu prüft, ob das Konto für
mindestens eines der Kinder des Eintrags `parent_portal.access` hat. Wer die
Rechte verliert, sieht die Einträge nicht mehr; gelöscht wird nichts.

Das Register der Transaktionsgrenzen (`backend/test/transaction_boundaries.json`)
wächst nicht. Eine neue Admin-Grenze braucht eine eigene Entscheidung, wie
ADR 0126 für den Dokumenteneingang der Eltern.

## Entscheidung

1. **Ein Admin-Rahmen je Aufruf.** Delivery liest und markiert den Feed eines
   Elternkontos in genau einer Admin-Einheit
   (`modules/delivery/internal/notifications/guardian_feed.go`,
   `guardianFeed.inAdminTx`): Seite und Zähler, ein Eintrag gelesen, alle
   gelesen. Jede Anweisung filtert auf das Konto der Sitzung.
2. **Die Rechte stehen in jeder Anweisung.** Ein Eintrag zählt nur, wenn das
   Konto in der Schule des Eintrags aktives Mitglied mit Eltern-Rolle ist und
   `parent_portal.access` für mindestens eines der Kinder des Eintrags hat.
   Die Prüfung nutzt `platform.delivery_realtime_recipients`, dieselbe Projektion,
   mit der Web Push und SSE Eltern zur Zustellzeit prüfen. Ein Eintrag ohne
   Kinder (Personal) erscheint nie im Elternportal; ein Eintrag mit Kindern nie
   im Staff-Portal.
3. **Geschrieben wird im Tenant-Rahmen des Auslösers.** Der Admin-Rahmen
   schreibt nur `read_at` von Einträgen des Kontos. Neue Einträge entstehen
   weiter in der Transaktion des Auslösers (ADR 0145, #7148).
4. **Kein Tenant-Rahmen dahinter.** Der Feed braucht keine Daten einer Schule
   außerhalb der Tabelle und der Projektion; ADR 0161 Punkt „Admin geht nur
   einseitig in den Tenant“ bleibt unberührt.

## Folgen

- Die Grenze steht als geprüfte Ausnahme in
  `backend/test/guardian_feed_transaction.go`; jede weitere Grenze braucht
  eine eigene Entscheidung.
- Ein Aufruf kostet fünf Anweisungen unabhängig von der Zahl der Einträge und
  Schulen (`parent.me.notifications.feed`).
- Verliert ein Konto die Rechte für ein Kind, verschwinden dessen Einträge beim
  nächsten Lesen. Bekommt es die Rechte zurück, sind sie wieder da, solange die
  Löschfrist von 30 Tagen nicht abgelaufen ist.

## Verworfene Alternativen

- **Ein Tenant-Rahmen je Schule.** Bräuchte erst eine Admin-Abfrage der
  Schulen des Kontos und dann je Schule eine Transaktion; mehr Grenzen und
  Anweisungen je Schule, ohne zusätzlichen Schutz, weil die Rechteprüfung
  ohnehin in jeder Anweisung steht.
- **Wiederverwenden einer vorhandenen Admin-Grenze** (etwa der Präferenzen).
  Ihr geprüfter Zweck ist ein anderer; eine stille Mitnutzung umginge das
  Register.
