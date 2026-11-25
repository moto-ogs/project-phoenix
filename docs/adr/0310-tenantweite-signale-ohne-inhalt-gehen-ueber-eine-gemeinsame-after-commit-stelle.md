---
status: accepted
---

# Tenantweite Signale ohne Inhalt gehen über eine gemeinsame After-Commit-Stelle

Entscheidung vom 2026-11-23 für
[#7693](https://github.com/moto-ogs/project-phoenix/issues/7693), Nachtrag zu
[ADR 0067](0067-principle-owners-meet-through-contracts-and-write-together-in-workflows.md)
Punkt 6. Sie ändert keinen Owner, keine Policy-Regel und kein bestehendes
Signal.

## Kontext

ADR 0067 Punkt 6 hält jedes `go`, `Dispatch` und `AfterCommit` in HTTP-,
Application- und Composition-Rollen im Register
`backend/test/durable_side_effect_notices.json` fest. Das Register darf nur
schrumpfen (`TestDurableSideEffectsRatchet`, `sideEffectRegisterOnlyShrinks`).
Ein neues Live-Signal, das nach dem Commit an alle Staff-Sitzungen einer Schule
geht und nichts außer seinem Namen trägt, brauchte bisher eine eigene
After-Commit-Stelle und damit einen neuen Eintrag. Das betraf zuerst den
Kalender: Seit #7663 zeigt „Heute anders“ abgesagte und geänderte Termine, aber
kein Schreibweg des Kalenders löste ein Event aus.

Erwogen wurden:

1. **Eine Ausnahme im Register für den Kalender.** Das Register wüchse, und
   jedes weitere Signal gleicher Art käme mit derselben Begründung nach.
2. **Eine gemeinsame, an ein Event gebundene Stelle in Delivery.** Neue Signale
   nutzen sie ohne neuen Eintrag.
3. **Die Stelle in eine Adapter-Rolle legen.** Der Scan sähe sie nicht. Das
   umginge das Register und ist ausgeschlossen.

## Entscheidung

Variante 2.

1. Delivery hat genau eine After-Commit-Stelle für tenantweite Signale ohne
   Inhalt: `BoundTenantSignal.Announce` in
   `modules/delivery/internal/application/realtimeevents/tenant_signal.go`. Sie
   sendet nach dem Commit das Event ihres Signals mit leeren Daten über
   `BroadcastToTenant` an die Staff-Sitzungen der Schule des Kontexts. Ein
   Rollback verwirft es. Ohne Schule oder mit unbekanntem Signal sendet sie
   nichts.
2. Ein Signal ist ein Wert von `TenantSignal` und an genau ein Event gebunden.
   Ein neues Signal ist ein neuer Wert dort und ein Event in
   `realtime/events.go`, keine neue After-Commit-Stelle und kein neuer
   Registereintrag.
3. Owner erreichen die Stelle über einen eigenen Port. Die Wurzel bindet ihn
   über `deliveryCompose.NewTenantSignal(hub, logger, event)`. Delivery prüft,
   ob das Event als inhaltsloses Signal zugelassen ist. Der Owner ruft den Port
   in seiner Transaktion. Der Kalender ist der erste Nutzer:
   `calendar_appointments_changed` nach jeder Termin-Schreibung
   (`withinAppointmentWrite`: Anlegen, Ändern, Absagen, Löschen, Absage eines
   einzelnen Termins einer Serie, Schultermine, Elternsprechtag-Buchungen).
4. `TestDurableSideEffectsRatchet` kennt die Stelle über einen einzigen
   festen Schlüssel (`sharedTenantSignalSite` in
   `backend/test/shared_tenant_signal_site_test.go`): Pfad, Funktion, Vorkommen und
   Fingerabdruck des ganzen Callbacks. Nur dieser eine Fund fällt aus der
   Prüfung. Ein zweiter Aufruf in der Funktion, eine Kopie an anderer Stelle oder
   ein geänderter Callback ist ein neuer Fund und scheitert wie bisher. Fehlt der
   Fund, scheitert der Test ebenfalls; dann braucht die Stelle eine neue
   Entscheidung. Das Register selbst bleibt unverändert und schrumpft weiter nur.
5. Bestehende Signale bleiben, wo sie sind. Ihr Umzug auf die gemeinsame Stelle
   ist eine eigene Aufgabe; jeder Umzug entfernt einen Registereintrag.

## Folgen

- Das Register wächst für diese Art Signal nicht mehr. Der Preis ist ein fester
  Schlüssel im Ratchet. Er erlaubt keine Arbeit, die das Register nicht schon
  erlaubt: Der Callback ist festgeschrieben und sendet nur ein Event ohne Inhalt.
- Ein Signal mit Inhalt, an einzelne Konten oder an andere Portale passt nicht
  auf die Stelle und braucht weiter einen eigenen Weg mit eigener Begründung.
- Die Signale sind verlustbehaftet (ADR 0145). Leser laden bei Fokus, nach
  erneuter Verbindung und über ihre Abfrage nach; ein verlorenes Event verzögert
  nur die Anzeige.

## Nachtrag: Eigene Zeiterfassung (#8081)

Workforce meldet Zeitbuchungen, Arbeitszeitmodelle und Monatsabschlüsse weiter
mit `staff_time_tracking_changed`. Änderungen an Abwesenheiten melden jetzt
`staff_leave_changed`. Beide Namen laufen über den bestehenden, unveränderten
Callback in Delivery; der frühere eigene Callback für Zeiterfassungsänderungen
und sein Registereintrag entfallen. Beide Signale tragen weiterhin keine IDs,
Tage oder Inhalte. Das zweite Signal lässt die Urlaubsansicht bei reinen
Zeitbuchungen unverändert.
