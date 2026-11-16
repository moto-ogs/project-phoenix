---
status: accepted
---

# Delivery, Scheduler Runtime und Communication beziehen ihre Uhr aus der Komposition

Entscheidung vom 2026-11-16 für
[#7104](https://github.com/moto-ogs/project-phoenix/issues/7104). Sie wendet
[ADR 0239](0239-owner-beziehen-ihre-uhr-aus-der-komposition.md) und
[ADR 0240](0240-stoppuhren-sind-keine-uhr-und-care-plan-bezieht-seine-uhr-aus-der-komposition.md)
auf drei weitere Owner an und führt keinen neuen Owner, Port oder keine neue
Policy-Regel ein.

## Kontext

`TestModuleLiveClockRatchet` zählte bei Delivery 44, bei Scheduler Runtime 36
und bei Communication 15 direkte Uhr-Aufrufe. Delivery entscheidet mit der
Uhr über Leases, Dispatch-Fences und Wiederholungszeiten seiner Outboxen, der
Worker der Scheduler Runtime darüber, wann ein Job fällig ist. Zwei Tests
dieser Owner standen in `calendarFixtureShiftedLiveDateDebt`:
`surveys_anonymity_test.go` (3 Funde) ließ sich nicht festpinnen, weil die
Datenbank `created_at` der Trägermitteilung einer Umfrage setzte und
`chk_parent_announcements_expiry` an späteren Tagen brach;
`email_delivery_events_test.go` (2 Funde) rechnete das Abgleichsfenster der
Mails vom echten Tag aus.

Die Wiederholung einer Träger-Mail setzte `next_retry_at = NOW()` in SQL,
der Worker vergleicht beim Holen aber mit seiner Go-Uhr. Das sind zwei Uhren
in einer Entscheidung.

## Entscheidung

1. **Eine Uhr je Owner aus der Wurzel.** `ModuleDependencies.Now` speist den
   Postgres-Store, den Dienst, den Worker und die Mail-Ereignisse von
   Delivery; der Worker reicht seine Instants für Claim, Lease und Fence an
   den Store, der Store stempelt seine eigenen Schreibvorgänge mit derselben
   Uhr. `WorkerDependencies.Now` speist alle Jobs des Workers und die
   Holder-ID der Worker-Lease. Communication bekommt die Uhr über
   `Dependencies.Now` (Plattform-Ankündigungen), `StaffMessagingConfig.Now`
   (Aufbewahrung der Mitarbeiter-Nachrichten), die Stores der
   Eltern-Ankündigungen und Umfragen sowie die HTTP-Ressourcen, die den Status
   einer Ankündigung oder Umfrage zeigen. Die Wurzel reicht
   `RootEnvironment.Now`; nil ist die echte Uhr, und dieser Standard steht in
   der Komposition oder, wo die Komposition die Uhr als Pflichtparameter
   nimmt, in der Wurzel (`clockOrReal`).
2. **Ein Takt bleibt monoton.** Die Lease-Laufzeit der Worker-Führung, der
   Minutentakt des Workers, die Nachprüfung eines offenen SSE-Streams, das
   Intervall der Drop-Logzeilen und das Alter des PWA-Snapshots messen
   verstrichene Zeit gegen Timer. Eine feste Testuhr würde sie anhalten; sie
   lesen weiter die echte Uhr. Gleiches gilt für die beiden
   Idempotenzschlüssel, deren Nanosekunde nur Eindeutigkeit stiftet (erneuter
   Versand eines Briefs, Test-Benachrichtigung). Jede verbleibende Stelle
   steht mit Funktion und Grund über ihrem Budgeteintrag.
3. **Die Träger-Wiederholung nimmt die Uhr des Stores** (`?5` statt `NOW()`),
   also die Uhr, mit der der Worker holt.
4. **Anlagezeitpunkte aus der Uhr des Stores.** Eine Eltern-Ankündigung ohne
   gesetzten Zeitpunkt und eine neue Umfrage bekommen `created_at` und
   `updated_at` aus der Uhr des Stores. Der Anonymitätstest läuft damit auf
   einem festen Tag, ohne dass der Check an einem späteren Tag bricht.
5. **Wer einen Zeitpunkt vergleicht, liest die Uhr, die ihn gestempelt hat.**
   Der Worker der Scheduler Runtime misst das Intervall der
   Sitzungsbereinigung mit seiner Uhr, die auch den letzten Lauf stempelt.
   Die Outboxen stempeln `created_at` und `updated_at` einer neuen Absicht mit
   der Uhr des Stores statt mit `NOW()`; der Worker und der Mail-Transport
   messen daran das Drossel-Fenster und die Wartezeit, der Worker das Alter
   des Rückstands. Der Hub lädt weitergeleitete Benachrichtigungen und die
   nächtliche Aufbewahrung löscht sie mit der Uhr, die sie gestempelt hat;
   der Mail-Dispatcher stempelt `SentAt` mit der Uhr der Wurzel.
6. **`updated_at` mit Trigger bleibt auf der Datenbankuhr.** Tabellen, deren
   Trigger `update_modified_column()` `updated_at` bei jedem UPDATE setzt,
   bekommen beim UPDATE kein `updated_at` aus Go; eine Methode, die die Zeile
   nach dem UPDATE zurückgibt, liefert den gespeicherten Wert (`RETURNING`).
   Offen bleiben zwei Aufbewahrungsentscheidungen, die `updated_at` eines
   Entwurfs mit einem Stichtag der injizierten Uhr vergleichen
   (`announcementEndedBefore`, `SurveyStore.ExpiredSurveys`).
7. **Budgets.** Das Compose-LOC-Budget steigt nur um die Uhrfelder, ihren
   nil-Standard und die `time`-Importe: `modules/communication/composition`
   von 380 auf 387 (+7), `modules/delivery/compose` von 393 auf 401 (+8), die
   Summe von 13.540 auf 13.555. Die Uhrparameter von Hub, Aufbewahrung und
   Mail-Dispatcher passen in dieses Budget.

## Folgen

- Das Uhr-Budget fällt von 665 auf 587 Aufrufe: Delivery von 44 auf 5,
  Scheduler Runtime von 36 auf 11, Communication von 15 auf 1.
- `calendarFixtureShiftedLiveDateDebt` verliert beide Einträge dieser Owner
  (5 Funde).
- Die Command-Effects ändern sich nicht: Uhren sind nach ADR 0239 effektfrei.
- Die Pass-through-Evidence von
  `AnnouncementsResource.GetAnnouncement` enthält jetzt die Uhr der Ressource.
