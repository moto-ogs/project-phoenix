# ADR 0321: Eltern widerrufen Einwilligungen der Ferienanmeldung, und die ausrichtende OGS liest sie live

Datum: 2026-11-24
Status: Akzeptiert

Entscheidung zu [#8038](https://github.com/moto-ogs/project-phoenix/issues/8038)
(Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611), User
Story 122, abgespalten aus #4721). Sie ergänzt
[ADR 0116](0116-ausrichtende-ogs-liest-ihre-teilnehmer-in-der-schul-transaktion.md)
Punkt 2 und
[ADR 0216](0216-ferienanmeldung-kennt-das-elternkonto-und-eltern-ohne-schule-bekommen-ein-konto-am-traeger.md)
Punkt 9 und führt keinen neuen Owner ein.

## Kontext

Der Träger fragt im Formular der Ferienanmeldung freiwillige Einwilligungen
ab: Rechtstext-Blöcke der Art `consent`, etwa „Fotos in der Ferienbetreuung:
Mein Kind darf auf Erinnerungsfotos zu sehen sein“. Eine Einwilligung hält
das Absenden nie auf (Art. 7 Abs. 4 DSGVO, `form_schema.go`). Gespeichert ist
nur, wann die Eltern sie gegeben haben (`legal_acceptances`). Bisher galt:

- Eltern sehen sie nach dem Absenden nicht mehr und können sie in moto nicht
  widerrufen. Art. 7 Abs. 3 DSGVO verlangt einen Widerruf, der so einfach ist
  wie die Erteilung; die Erteilung war ein Haken im Formular.
- Die ausrichtende OGS, deren Team die Fotos macht, sieht sie nicht
  (ADR 0116 Punkt 2). Nur das Träger-Büro sieht sie an der Anmeldung.
- Für einen Feriengast ohne Heimatschule beim Träger sind das die einzigen
  Einwilligungen; die Foto-Einwilligung der Heimatschule (#4721) gibt es für
  ihn nicht.

## Entscheidung

1. **Ein Stand, eine Quelle.** Die Anmeldung bleibt die einzige Quelle.
   `enrollment.holiday_registrations` bekommt `legal_withdrawals` (JSON-Objekt
   je Schlüssel: wann widerrufen). Ein Widerruf nimmt den Schlüssel aus
   `legal_acceptances` und trägt ihn in `legal_withdrawals` ein; ein
   erneutes Geben macht es umgekehrt, mit dem neuen Zeitpunkt. Damit liest
   jeder bisherige Leser der Zustimmungen (Erklärung als PDF, Export, Prüfung
   im Träger-Büro) einen widerrufenen Haken ohne Änderung als „nicht
   gegeben“. Kopiert wird nichts; es gibt keinen Abgleich, der veralten kann.
2. **Was Eltern sehen und ändern.** `GET
   /parent/me/holiday-registration-entries` nennt je Anmeldung die
   aktivierten Einwilligungen ihrer Formularversion in der Reihenfolge des
   Formulars, im Wortlaut, mit dem sie gegeben wurden (Titel, Satz,
   Erklärung), ob sie gerade gelten und seit wann, oder seit wann sie
   widerrufen sind. `PUT .../{registrationId}/consents/{key}` mit
   `{"given": false|true}` widerruft oder gibt wieder. Das gilt für jede
   Anmeldung mit dem Konto, auch eine stornierte oder vergangene: Ein
   Widerruf ist nie zu spät, und die Anmeldung hält die Angabe bis zu ihrer
   Löschfrist (ADR 0118). Geben können Eltern auch eine Einwilligung, die sie
   beim Absenden nicht angekreuzt haben: Sie ist freiwillig, und der Wortlaut
   ist der ihrer Formularversion. Ändern lässt sich nur eine aktivierte
   Einwilligung dieser Version; Hinweise, Bedingungen und Schlüssel fremder
   Versionen antworten 404 (`enrollment.holiday_registration_entry_not_found`),
   ebenso eine Anmeldung eines anderen Kontos. Eine Einwilligung, die schon
   so steht, bleibt unverändert und schreibt keinen Eintrag.
3. **Was nicht hier widerrufen wird.** Datenschutzkenntnisnahme und
   Gesundheitsangaben (`privacy_consent_at`, `health_consent_at`, #4722) sind
   keine Rechtstext-Blöcke. Ihr Widerruf heißt Löschung der
   Gesundheitsangaben beim Träger und in der ausrichtenden OGS und bleibt
   beim Träger-Büro (`docs/operations/einwilligung-widerruf-3844.md`,
   Abschnitt 2.4).
3a. **Widerruf über das Träger-Büro.** Eltern ohne Elternkonto widerrufen
   beim Träger, per Mail, Brief oder Telefon. Das Büro trägt den Widerruf an
   der Anmeldung ein (`POST
   /traeger/holiday-periods/{id}/registrations/{registrationId}/consents/{key}/withdraw`,
   Recht „Anmeldung verwalten“). Er läuft durch dieselbe Änderung der
   Anmeldung wie Einfrieren und Wiedereröffnen, in der Träger-Transaktion der
   Route, und steht als `consent` mit dem Büro als Urheber im Verlauf. Das
   Büro trägt nur Widerrufe ein; eine Einwilligung geben können nur die
   Eltern. Eine Einwilligung, die nicht gilt oder die die Formularversion
   nicht fragt, antwortet 409 (`enrollment.holiday_registration_state_conflict`).
4. **Transaktion und Protokoll.** Der Workflow Elternportal ändert in einer
   Admin-Transaktion wie die Liste (ADR 0216 Punkt 9) mit genau einer
   Anweisung: Sie sperrt die Anmeldung mit Konto, Anmeldung und Schlüssel im
   Filter, ändert sie nur bei anderem Stand und schreibt im selben Zug den
   Eintrag `consent` in `enrollment.holiday_registration_audit`, mit dem
   Elternkonto als Urheber, dem Schlüssel, dem neuen Stand, der
   Formularversion und den Zeitpunkten der beendeten Erteilung oder des
   beendeten Widerrufs. Das Träger-Büro sieht den Eintrag im Verlauf der
   Anmeldung und im Zugriffsprotokoll des Trägers. Die Zeitpunkte nimmt der
   Store von der Uhr der Wurzel (ADR 0239).
5. **Ausrichtende OGS, live.** `enrollment.holiday_host_registration_consents
   (organization_id, week_id, child_id)` (`SECURITY DEFINER`, wiederholbare
   Definition nach ADR 0223) antwortet nur, solange
   `enrollment.holiday_host_booking` der Schule der Sitzung die Buchung
   zugesteht: ausrichtende Schule am selben Träger, veröffentlichter
   Zeitraum, bestätigte Anmeldung, platzierte Buchung, letzter Tag nicht
   vorbei. Sie liefert je Einwilligung Schlüssel, Titel, Satz, Stand und
   Zeitpunkt und sonst nichts aus der Anmeldung, keine Erklärung, keine
   Eltern, keine Antworten. Die Teilnehmerliste (`GET
   /api/holiday-weeks/{weekId}/participants`), ihr Export (eine Spalte
   „Einwilligung: …“ je Einwilligung) und das Blatt des Feriengasts (`GET
   /api/holiday-guests/{studentId}`) lesen sie in ihrer vorhandenen
   Anweisung mit; die Abfrage-Budgets bleiben unverändert. Das Blatt nennt
   sie bis zum letzten Tag der Woche, danach nicht mehr (wie die
   Foto-Einwilligung der Heimatschule, ADR 0120 Nachtrag vom 24.11.2026).
   Der Zugriff steht wie bisher als `holiday_participants`,
   `holiday_participants_export` und `holiday_guest_sheet` im
   Zugriffsprotokoll der ausrichtenden Schule; deren Bezeichnungen nennen
   die Einwilligungen.
6. **Heimatschule und Ferienanmeldung widersprechen sich.** Beide Angaben
   bleiben getrennt und tragen ihre Quelle: die Foto-Einwilligung der
   Heimatschule (#4721) unter „Fotos“, die Einwilligungen des Trägers unter
   „Einwilligungen aus der Ferienanmeldung“. moto deutet keinen Titel und
   verrechnet nichts, denn ein Träger-Block kann jedes Thema haben. Stehen
   beide da und sagt die eine Ja, die andere Nein, nennt das Blatt die Regel:
   Betrifft beides dasselbe Thema, gilt das Nein, bis die Eltern es geklärt
   haben. Das ist die vorsichtige Lesart (Art. 7 Abs. 1 DSGVO: Der
   Verantwortliche muss die Einwilligung nachweisen; ein Widerspruch weist
   sie nicht nach) und deckt sich mit dem Hinweis aus #4721, ohne
   Einwilligung keine Fotos zu machen.
7. **Register.**
   - `test/transaction_boundaries.json` und
     `holidayParentRegistrationTransactionSites`: die neue Stelle
     `*Service.ChangeHolidayRegistrationConsent` (Admin-Transaktion).
   - `parent_child_write_guard.go`:
     `care.HolidayParentRegistrations.SetHolidayRegistrationConsent` ist ein
     Schreiben ohne Kind einer Schule, wie `ClaimHolidayRegistrations`.
   - Die Route des Büros braucht keine neue Stelle: Sie läuft in der
     Träger-Transaktion der Route wie Einfrieren; die Fähigkeit
     `HolidayConsentWithdrawals` ist eine eigene, schmale Schnittstelle neben
     der Prüfung, die dieselbe Anwendung erfüllt.
   - Nutzungsanalyse: Beide Routen zählen nicht (`notCaptured`). Die Anmeldung
     gehört einem Träger und nennt keine Schule der Sitzung; Eltern ohne
     Schule haben gar keine.
   - Keine neue Tabelle, kein neuer Port eines anderen Owners, keine neue
     Regel in `policy.json`, kein neues Abfrage-Budget.

## Verworfene Optionen

- **Widerruf nur im Verlauf, Zustimmung bleibt stehen:** Jeder Leser von
  `legal_acceptances` hätte den Verlauf mitlesen müssen; die Erklärung als
  PDF und der Export hätten einen widerrufenen Haken weiter als gegeben
  gezeigt.
- **Eigene Tabelle der Einwilligungen:** gäbe einen zweiten Stand neben
  `legal_acceptances` und eine Abfrage mehr auf Routen mit festem Budget.
- **Kopie in den Feriengast (ADR 0120):** veraltet beim ersten Widerruf und
  bräuchte einen Abgleich; die Liste vor der Woche hätte sie nicht.
- **Widerruf ohne Konto über einen Link in der Mail:** Eltern ohne Konto
  bekommen schon mit der Annahme-Mail den Weg zum Konto (ADR 0216 Punkt 11);
  ein zweiter, ungeschützter Weg je Mail lohnt nicht.
- **Ein Titel mit „Foto“ zählt als Foto-Einwilligung:** moto würde einen
  freien Text des Trägers deuten und läge bei „Fotos für die Zeitung“ oder
  einem anderen Wortlaut falsch.

## Folgen

- Das Träger-Büro sieht an der Anmeldung, in der Erklärung als PDF und im
  Verlauf, wann die Eltern widerrufen haben.
- Eltern ohne Elternkonto widerrufen weiter beim Träger; die Annahme-Mail
  führt sie zum Konto.
- Die Einwilligungen tragen ihre Formularversion; welcher Wortlaut galt,
  steht in der gespeicherten Version (`enrollment.holiday_period_forms`).
