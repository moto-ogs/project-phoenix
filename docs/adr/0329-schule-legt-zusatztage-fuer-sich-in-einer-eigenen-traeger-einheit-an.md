# ADR 0329: Die Schule legt Zusatztage für sich in einer eigenen Träger-Einheit an

Datum: 2026-11-27
Status: Akzeptiert

Entscheidung zu [#4817](https://github.com/moto-ogs/project-phoenix/issues/4817)
und [#8250](https://github.com/moto-ogs/project-phoenix/issues/8250),
freigegeben von Yannick Wenger am 27.11.2026: Die Schule legt einen Zusatztag
für die eigene Schule selbst an, im selben PR wie die Zusatztage des Trägers.
Sie ergänzt
[ADR 0086](0086-traeger-werte-liegen-zwischen-standard-und-schule.md)
Abschnitt 5 und
[ADR 0105](0105-ferienzeitraum-liegt-beim-traeger-in-der-traeger-transaktion.md)
Punkt 3 und 4 um genau einen Fall und führt keinen neuen Owner ein.

## Kontext

Ein Zusatztag (Brückentag, beweglicher Ferientag) ist ein Ferienzeitraum der
Art `extra_day` in `enrollment.holiday_periods`. Die Zeilen gehören dem Träger
und liegen hinter der Policy `organization_id = app.current_org_id`. ADR 0086
Abschnitt 5 schließt das Schreiben aus der Schul-Transaktion aus, und nach
ADR 0105 öffnet nur `common.TraegerTxMiddleware` die Träger-Transaktion, für
eine Route des Träger-Portals. #4817 verlangt, dass auch die Schule einen
Zusatztag anlegt. Ohne Entscheidung blieb dafür nur der Weg über das
Träger-Büro.

[ADR 0196](0196-schul-schliesstage-informieren-ferienfamilien-ueber-ein-dauerhaftes-ereignis.md)
hat das Muster schon: Eine Schul-Route ohne Transaktion um den Handler öffnet
nach der Schul-Einheit eine getrennte Träger-Einheit. Die Schule bekommt eine
eng begrenzte Befugnis, keine Träger-Sitzung.

## Entscheidung

1. **Die Zeile bleibt beim Träger.** Der Zusatztag der Schule ist dieselbe
   Zeile wie der des Träger-Büros. Es gibt keine zweite Tabelle, keine zweite
   Policy auf `enrollment.holiday_periods` und kein Schreiben in der
   Schul-Transaktion. ADR 0086 Abschnitt 5 gilt unverändert.
2. **Eigene Träger-Einheit der Schul-Route.** `/api/holiday-extra-days` liegt
   hinter der Schul-Sitzung und öffnet keine Transaktion um den Handler. Der
   Handler liest zuerst in der Schul-Einheit den Träger der Schule der Sitzung
   aus `platform.schools` (Organisation & Tenancy, Port
   `enrollment.HolidayHostTraeger`). Danach öffnet er mit
   `tenant.WithinTraeger` die Träger-Transaktion dieses Trägers, mit maskierter
   Schule. Keine Einheit läuft in der anderen. Schule und Träger kommen aus der
   Sitzung, nie aus der Anfrage.
3. **Enge Befugnis in Enrollment.** `enrollment.SchoolExtraDays` lässt nur zu:
   - Anlegen eines Zusatztags, dessen einzige ausrichtende Schule die Schule
     der Sitzung ist. Die Art ist immer `extra_day`, was auch immer die
     Anfrage nennt. Eine andere Schule wird mit 403 abgelehnt.
   - Lesen, Ändern und Veröffentlichen nur der Tage, die die Schule selbst
     angelegt hat (`created_by_school_id`) und noch allein ausrichtet. Ein Tag
     des Träger-Büros, einer anderen Schule oder eines anderen Trägers ist für
     die Schule nicht vorhanden (404).
   Ändern und Veröffentlichen prüfen das auf der gesperrten Zeile, damit eine
   Änderung des Büros dazwischen nicht an der Prüfung vorbeigeht. Die Schule
   schreibt genau einen Tag mit einer Betreuungszeit. Was nur das Büro
   entscheidet, bleibt wie gespeichert: der Text der Zusage-Mail, die Plätze
   des Tages (die Schule ersetzt die gespeicherte Woche nie) und eine zweite
   Betreuungszeit, die das Büro ergänzt hat.
   Die Regeln eines Zusatztags (ein Werktag, kein Feiertag und kein
   Schließtag, Beitragswahl nach dem Veröffentlichen gesperrt) sind dieselben
   wie beim Träger-Büro, weil derselbe Befehl sie prüft.
4. **Recht.** Die Route verlangt `schedules:update`, das Recht, mit dem die
   Schule ihre Schließtage plant. Ein Zusatztag ist das Gegenstück dazu.
5. **Was beim Träger-Büro bleibt.** Plätze und Warteliste, die Prüfung und
   Bestätigung der Anmeldungen, Formular und Dokumente, Mailtext und die
   Abrechnung. Die Schule sieht die bestätigten Kinder wie bisher unter
   `Ferienwochen` (ADR 0116). Sie bekommt keine Elternkontakte des Trägers.
6. **Beitrag.** Die Schule wählt wie das Büro „Im Monatsbeitrag enthalten“
   oder „Mit Tagespreis“; #4817 verlangt die Wahl je Zusatztag. Ein Tagespreis
   wird vom Träger-Büro abgerechnet. Damit das Büro einen solchen Tag erkennt,
   trägt die Zeile die anlegende Schule, und das Träger-Portal zeigt sie.
7. **Herkunft.** `created_by_school_id` wird nur beim Anlegen durch die Schule
   gesetzt und nie geändert. Die Spalte ist wie `host_school_id` kein
   Fremdschlüssel (ADR 0105 Punkt 5). Erweitert das Träger-Büro den Tag um
   eine weitere Schule, ist er ein Tag des Büros: Die Schule ändert ihn nicht
   mehr und liest ihn veröffentlicht unter `Ferienwochen`.
8. **Register.** Das Transaktionsregister erhält genau zwei Stellen mit festem
   Grund (`backend/test/school_extra_day_transaction.go`): die Schul-Einheit,
   die den Träger nennt, und die Träger-Transaktion der Route. Jede weitere
   Stelle braucht eine eigene Entscheidung.

## Folgen

- Kein Workflow: Anlegen, Ändern und Veröffentlichen schreiben nur
  Enrollment (ADR 0105 Punkt 7). Die Lesung des Trägers ist eine Abfrage über
  einen consumer-eigenen Port.
- Gleichzeitige Änderungen von Schule und Büro am selben Tag trennt die
  Lesefassung (ADR 0311): Wer auf einem alten Stand speichert, wird abgelehnt.
- Der Zusatztag enthält keine personenbezogenen Daten. Die Spalte
  `created_by_school_id` steht im Rückgabe-Register des Trägers.

## Verworfene Optionen

- **Zwei-Schlüssel-Tabelle mit Wunsch der Schule**, den das Büro übernimmt:
  kein Schreiben in Träger-Zeilen, aber ein zweiter Schritt im Büro. Die
  Schule legte dann nicht selbst an.
- **Schreib-Policy für die Schule auf `enrollment.holiday_periods`**: Sie
  höbe ADR 0086 Abschnitt 5 für die ganze Tabelle auf. Die enge Befugnis läge
  dann in SQL-Policies statt in einem Befehl.
- **Nur das Träger-Büro legt an:** erfüllt #4817 nicht.
