---
status: accepted
---

# Caterer-Einladungen entscheiden auf der Datenbankuhr

Entscheidung vom 2026-11-17 für
[#7295](https://github.com/moto-ogs/project-phoenix/issues/7295). Sie wendet
[ADR 0281](0281-jede-zeitspalte-hat-eine-uhr-trigger-und-spaltenvorgaben-bleiben.md)
Punkt 3 und seinen Nachtrag vom 2026-11-17 an, wie
[ADR 0284](0284-freigabe-und-abruf-der-datenrueckgabe-entscheiden-auf-der-datenbankuhr.md)
für die Datenrückgabe: Eine Entscheidung, die eine Funktion der Datenbank
mit ihrer Uhr bewacht, liegt ganz auf dieser Uhr.

## Kontext

Die Sicherheitsfunktion `auth.create_invited_caterer` (1.15.604) legt den
Caterer einer neuen Adresse nur für eine offene Einladung der Schule an:
`expires_at > statement_timestamp()`. Ebenso zählen `auth.account_is_unused`
und `auth.delete_unused_caterers` eine Einladung als offen. Go leitete
`expires_at` aus der Uhr von Identity & Access ab, prüfte Vorschau, Annahme
und die offenen Einladungen der Schule damit und stempelte `accepted_at` und
`revoked_at` ebenso. Die Aufbewahrung von 30 Tagen schnitt mit derselben Uhr
ab. Das HTTP der Caterer-Seite nannte den Status „abgelaufen“ nach der Uhr
der Wurzel. Lief die Uhr des Rechners einen Monat zurück, lag `expires_at`
für die Datenbank in der Vergangenheit: Die Annahme einer neuen Adresse
scheiterte mit SQLSTATE 42501. Lief sie vor, hielt die Datenbank die
Einladung länger offen, als Go sie zeigte.

## Entscheidung

1. Alle Zeitpunkte von `auth.caterer_invitations` liegen auf der
   Datenbankuhr: `expires_at`, `accepted_at`, `revoked_at` und, wie schon
   bisher durch die Spaltenvorgabe, `created_at`.
2. Jede Operation liest die Datenbankzeit einmal, in ihrer Transaktion, über
   die Konstante `databaseClock` (`statement_timestamp()`, wie die
   Funktion) im Postgres-Adapter von Identity & Access:
   - Einladen und Zurücknehmen lesen sie mit `DatabaseTime`. Aus ihr
     entstehen `expires_at` (14 Tage), die Prüfung der offenen Einladungen
     und `revoked_at`.
   - Die Liste liest sie in derselben Abfrage wie die Einladungen
     (`read_at`). So bleibt sie bei einer Abfrage.
   - Vorschau und Annahme sperren die Einladung mit `FOR UPDATE` und lesen
     die Zeit danach mit `DatabaseTime`. Die Zeit der sperrenden Abfrage
     selbst läge vor dem Warten auf eine andere Vorschau oder Annahme; eine
     Einladung, die währenddessen abläuft, gälte sonst noch als offen.
   - Die Schreibvorgänge der Annahme prüfen den Ablauf noch einmal zu ihrer
     eigenen Zeit: Das `UPDATE`, das `accepted_at` stempelt, trägt
     `expires_at > statement_timestamp()`, und `auth.create_invited_caterer`
     wird nur für eine bis dahin nicht abgelaufene Einladung aufgerufen, zur
     selben Zeit, die die Funktion prüft. Beides antwortet
     `ErrInvitationExpired`; die übrigen Wächter der Funktion antworten
     weiter mit SQLSTATE 42501.
   - Die Mail nennt die Gültigkeit in Tagen, wie sie auf der Datenbankuhr
     ausgestellt wurde: Identity & Access übergibt der Zustellung den Ablauf
     auf der Uhr der Komposition (ihre Zeit plus die Laufzeit ab der
     Datenbankzeit der Einladung), und die Zustellung zählt auf derselben
     Uhr. Der Port der Zustellung bleibt unverändert.
   - Die Aufbewahrung liest sie einmal je Lauf und zählt die 30 Tage davon
     zurück.
3. Die öffentliche `CatererInvitation` trägt `Expired`, auf der
   Datenbankuhr entschieden. Das HTTP der Caterer-Seite liest den Status
   daraus und braucht keine Uhr mehr.
4. Die Wächter der Funktion bleiben unverändert: Schule der Transaktion,
   Adresse des Kontos, offene Einladung.
5. Auf der Uhr von Identity & Access bleibt die Belieferung
   (`auth.caterer_schools.started_at`, `ended_at`): Kein Wächter der Datenbank
   vergleicht sie.

## Folgen

- `moduleSQLClockBudget["modules/identityaccess"]` steigt von 4 auf 5: die
  Konstante `databaseClock`. Ihre Verwendungen in `read_at`, `DatabaseTime`
  und den Wächtern der Annahme zählen nicht noch einmal.
- `TestCatererInvitationDecidesOnTheDatabaseClockWithGoAhead` und
  `…WithGoBehind` halten Einladung, Liste, Vorschau und Annahme mit einer
  Go-Uhr einen Monat vor und zurück, samt der Gültigkeit in der Mail.
  `TestCatererInvitationExpiredDuringTheLockWaitIsRefused` lässt eine
  Einladung ablaufen, während eine andere Transaktion sie sperrt;
  `TestCatererInvitationWritesRefuseAnInvitationExpiredAtTheirOwnTime` hält
  die Wächter der Schreibvorgänge.
- Noch offen: `auth.account_is_unused` prüft auch Einladungen für
  Mitarbeitende (`auth.invitation_tokens`) und Eltern
  (`auth.guardian_invitations`) gegen `statement_timestamp()`, deren Ablauf
  Go stempelt. Ihre Annahme bewacht keine Funktion der Datenbank; nur die
  Kontolöschung hält ein Konto bei auseinanderlaufenden Uhren um diesen
  Abstand zu lang oder zu kurz. Sie folgen in einem eigenen Schnitt.

## Nachtrag 2026-11-17: Einladungen für Mitarbeitende und Eltern

Für [#7295](https://github.com/moto-ogs/project-phoenix/issues/7295) schließt
dieser Nachtrag den oben offenen Punkt. `auth.account_is_unused` behält ein
Konto, solange eine unbenutzte Einladung für Mitarbeitende
(`auth.invitation_tokens`) oder Eltern (`auth.guardian_invitations`) seine
Adresse nennt und `expires_at > statement_timestamp()` gilt. Go stempelte
`expires_at` mit der Uhr von Identity & Access. Lief sie einen Monat nach,
war eine neue Einladung für die Datenbank sofort abgelaufen: Die stündliche
Löschung konnte ein Konto unwiderruflich anonymisieren, das eine gültige
Einladung schützen sollte. Lief sie vor, blieb das Konto einen Monat zu
lange.

1. Wie bei den Caterer-Einladungen liegen alle Zeitpunkte beider Tabellen
   auf der Datenbankuhr: `expires_at`, `used_at` (Mitarbeitende) sowie
   `accepted_at` und `approved_at` (Eltern). `created_at` stempelt weiter
   die Spaltenvorgabe, `updated_at` der Trigger. Nur `email_sent_at`
   stempelt weiter die Zustellung; keine Entscheidung vergleicht es.
2. Jede Operation liest die Datenbankzeit über `databaseClock`:
   - Einladen, erneut Senden, Freigeben, Ablehnen, die Verknüpfung für
     Eltern und der Widerruf durch Eltern lesen sie einmal mit
     `DatabaseTime`. Daraus entstehen `expires_at` und die Stempel.
   - Die Listen (offene Einladungen der Schule, Kontoliste, Elternliste,
     offene Freigaben) vergleichen in derselben Abfrage mit
     `databaseClock`. Jede gelesene Elterneinladung trägt `Expired`,
     entschieden zur Datenbankzeit der lesenden Abfrage.
   - Erneutes Senden einer Einladung für Mitarbeitende sperrt die Zeile
     und liest die Zeit danach. Die Annahme sperrt sie nach Konto und
     Schule, in der Reihenfolge der Einladung, und prüft dort erneut.
     Das `UPDATE`, das `used_at` stempelt, trägt `expires_at >
     statement_timestamp()`. Unter der gehaltenen Sperre heißt 0 Zeilen
     „abgelaufen“.
   - Die Annahme einer Elterneinladung sperrt die Zeile vor dem `UPDATE`,
     das `accepted_at` stempelt und `expires_at >= statement_timestamp()`
     prüft. Verweigert es, nennt eine neue Lesung den Grund wie bisher.
   - Ablösen und Beenden von Elternlinks (`InvalidateGuardianInvitations`)
     setzen `expires_at` auf `LEAST(expires_at, statement_timestamp())`.
   - Das Aufräumen der Einladungen für Mitarbeitende vergleicht mit
     `databaseClock`. Die Aufbewahrung der Elterneinladungen zählt ihre
     30 Tage von `DatabaseTime` zurück. Träger-Einladungen bleiben auf der
     Uhr von Identity & Access.
3. Die Mails rechnen auf der Uhr der Komposition. Für Mitarbeitende erhält
   die Zustellung als Ablauf diese Uhr plus die Laufzeit. Der Renderer der
   Transaktionsmails verwirft damit keinen gültigen Link. Für Eltern erhält
   die Zustellung diese Uhr plus die verbleibende Zeit des Links zur
   Datenbankzeit der Operation. Beide Ports bleiben unverändert.
4. Für die Elternliste (People Directory) und das Elternportal entscheidet
   `Expired`. Keiner der beiden Owner hält eine eigene Uhr gegen
   `expires_at`.
5. Wächter, Mandantentrennung, Token-Hashing und Fehlercodes bleiben
   unverändert. `moduleSQLClockBudget["modules/identityaccess"]` bleibt
   bei 5: Alle neuen Stellen verwenden die Konstante.

Tests: `TestStaffInvitationProtectsTheAccountOnTheDatabaseClockWithGoAhead`
und `…WithGoBehind` sowie die Gegenstücke für Eltern prüfen mit einer Go-Uhr
31 Tage vor oder zurück: den Schutz durch `auth.account_is_unused`, die
Laufzeit und die Gültigkeit in der Mail.
`TestStaffAndGuardianInvitationExpiredDuringTheLockWaitIsRefused` lässt beide
Einladungen ablaufen, während eine andere Transaktion sie sperrt.
`TestGetStudentGuardians_OpenInvitationPendingOnTheDatabaseClock` hält die
Elternliste.

## Nachtrag 2026-11-18: Rollback der Adressbindung

Beim Rollback von 1.15.865 kann eine ältere Anwendung den Einladungsablauf
auf ihrer eigenen Uhr prüfen. Down setzt den Ablauf einer unverbrauchten
Einladung mit abweichender Empfängeradresse höchstens auf den Unix-Epoch.
Auf Freigabe wartende Anfragen erhalten später einen neuen Link. Die
Änderung gehört in Down von 1.15.865, da erst dieser Schritt die
Empfängerbindung entfernt. [#7383](https://github.com/moto-ogs/project-phoenix/issues/7383)

`api.NewAuthTestModule` ist für Elterneinladungsmails auf der echten Uhr
vorgesehen. Tests, die die Uhr bewegen und die Mail lesen, verwenden
`api.NewTestIdentityAccessWithConfig`. Dieser Testaufbau verwendet den
Produktionspfad mit derselben Uhr für Ausstellung und Zustellung.
`TestAuthTestModuleGuardianMailStatesTheLifetimeOnTheRealClock` und
`assertGuardianInvitationOnTheDatabaseClock` prüfen beide Fälle. So kann
der gemeinsame Testhelfer seine eingefrorenen Bindungen behalten.
