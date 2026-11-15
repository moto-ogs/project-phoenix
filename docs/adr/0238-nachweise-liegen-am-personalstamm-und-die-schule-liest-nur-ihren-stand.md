---
status: accepted
---

# Nachweise liegen am Personalstamm, und die Schule liest nur ihren Stand

Entscheidung vom 14.11.2026 für
[#4707](https://github.com/moto-ogs/project-phoenix/issues/4707), Etappe 4 der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Sie setzt
[ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
Abschnitt 7 um und nimmt die Entscheidung E4 vom 13.11.2026 aus #4707 auf. Sie
baut auf [ADR 0233](0233-personalakte-des-traegers-verknuepft-beschaeftigungen-und-uebernimmt-bankdaten.md)
(Personalstamm) und den Nachweisarten der Schule aus
[#4808](https://github.com/moto-ogs/project-phoenix/issues/4808) auf.

## Kontext

- E4: Die Nachweise liegen dort, wo die Personalakte geführt wird. Nutzt der
  Träger die Träger-App, führt er eigene Nachweise nach ADR 0089 §7; die
  Arten der Schulen werden einmal zugeordnet. Eine Schule ohne Träger-App
  behält ihre Nachweise wie heute.
- Die Schule hat seit #4808 Nachweisarten mit Gültigkeit, Vorlauf und Pflicht,
  eine Ablaufliste und Erinnerungen an Leitung und Person.
- § 72a Abs. 5 SGB VIII erlaubt beim Führungszeugnis nur drei Angaben: den
  Umstand der Einsichtnahme, das Datum des Führungszeugnisses und ob die
  Person wegen einer Straftat nach Abs. 1 Satz 1 rechtskräftig verurteilt
  ist. Eine Kopie erlaubt die Vorschrift in keinem Fall.
- Die Schule liest per RLS keine Träger-Tabelle außer den Verknüpfungen ihrer
  eigenen Beschäftigungen (ADR 0233 §3).

## Entscheidung

1. **Arten und Nachweise beim Träger.** `workforce.staff_proof_types` hält die
   Arten des Trägers mit Gültigkeit in Monaten, Vorlauf in Wochen und Pflicht,
   mit drei Standardarten: erweitertes Führungszeugnis (Pflicht, fünf Jahre,
   zwölf Wochen Vorlauf), Masernschutz (Pflicht, ohne Ablauf) und
   Präventionsschulung (fünf Jahre). `workforce.staff_proofs` hält je Art und
   Personalstamm einen Nachweis. Eine Erneuerung ersetzt ihn. Beide liegen in
   der Träger-Transaktion mit RLS über `organization_id`.
2. **Führungszeugnis ohne Kopie.** moto speichert das Datum der Einsicht, das
   Ausstellungsdatum und die bestätigte Aussage „keine einschlägige
   Eintragung“. Ein Führungszeugnis mit Eintragung trägt moto nicht ein;
   die Entscheidung über die Tätigkeit trifft der Träger außerhalb von moto.
   Die Tabelle hat keine Spalte, die ein Dokument oder einen Freitext
   aufnehmen könnte. Das Ablaufdatum folgt aus dem Ausstellungsdatum.
3. **Zuordnung der Schul-Arten.** `workforce.staff_proof_type_mappings` ordnet
   jede Art einer Schule höchstens einer Art des Trägers zu. Die Zeile nennt
   Schule und Schul-Art mit einfachen IDs wie die Verknüpfungen (ADR 0233 §3).
   Für eine Beschäftigung, die der Träger in einer Akte führt, erinnert die
   Schule nicht mehr an Nachweise einer zugeordneten Art; das tut der
   Nachweis des Trägers. Die Einträge der Schule bleiben unverändert.
4. **Die Schule liest nur den Stand.** Die Funktion
   `workforce.school_traeger_proof_status()` läuft als ihr Eigentümer und
   liefert der Schule ihrer Tenant-Transaktion je eigener verknüpfter
   Beschäftigung und Art nur Name, Pflicht, ob ein Nachweis da ist, sein
   Ablaufdatum, den Vorlauf und die zugeordneten Schul-Arten. Daraus zeigt die
   Schule „gültig“, „läuft bald ab“, „abgelaufen“ oder „fehlt“. Weder Daten der
   Einsicht noch das Ergebnis noch Beschäftigungen anderer Schulen verlassen
   die Funktion.
5. **Warnung über die Schulen.** Ein stündlicher Job des Workers liest je
   freigeschaltetem Träger die fälligen Nachweise in der Träger-Transaktion,
   schickt die Warnung in der Tenant-Transaktion jedes lebenden Einsatzorts an
   dessen Leitung (Recht `staff:stammdaten`) und einmal an die Person, mit den
   Texten und dem Benachrichtigungsfenster der Schul-Erinnerung, und hakt den
   Nachweis danach in der Träger-Transaktion ab. Keine Transaktion trägt beides
   (ADR 0105). Die Personalverwaltung sieht dieselben Nachweise auf der
   Ablaufliste des Träger-Portals mit Zahl und Stand.
6. **Ablaufliste und Export.** Die Liste und ihr CSV zeigen je Personalstamm
   und Art den Stand, das dringendste zuerst. Beide schreiben vorher je
   Einsatzort einen Eintrag ins Zugriffsprotokoll (`traeger_staff_records`);
   ohne Eintrag gibt es keine Antwort und keine Datei.
7. **Uhr.** Status und fällige Warnung rechnen mit dem Kalendertag der
   Workforce-Uhr (`application.Clock`), wie die Nachweise der Schule
   (ADR 0176). Die Uhr schreibt nichts.

## Verworfene Optionen

- **Nachweise der Schule beim Verknüpfen übernehmen:** Ein Nachweis der
  Schule hat einen freien Namen und kein Ergebnis. Die Übernahme müsste raten,
  welcher Eintrag welcher Art entspricht. Die Zuordnung je Art entscheidet das
  einmal, und die Personalverwaltung trägt den geprüften Nachweis ein.
- **Schule liest die Nachweise per RLS-Policy:** Eine Policy gibt ganze Zeilen
  frei, also auch Einsichtsdatum und Ergebnis. ADR 0089 §7 erlaubt der Schule
  nur den Stand.
- **Erinnerung je Schule im Schul-Job:** Die Schule dürfte den Stand der
  Erinnerung in einer Träger-Tabelle nicht schreiben, und eine Person mit zwei
  Einsatzorten bekäme zwei eigene Erinnerungen.
- **Ergebnis „mit Eintragung“ speichern:** § 72a Abs. 5 ließe es zu, aber es
  ist eine Angabe über eine Straftat. moto braucht sie nicht; der Träger setzt
  die Person dann nicht ein.

## Folgen

- Die Nachweise gehen mit dem Personalstamm: „Akte auflösen“ löscht sie, und
  mit dem Träger gehen alle. Die Frist nach dem Ende des letzten
  Arbeitsvertrags (ADR 0089 §12, § 72a Abs. 5 Satz 4: spätestens drei Monate
  nach Ende der Tätigkeit) kommt mit dem Arbeitsvertrag
  ([#4706](https://github.com/moto-ogs/project-phoenix/issues/4706)).
- Eine Mail an die Personalverwaltung braucht die Konten des Träger-Büros mit
  dem Recht „Personal“ als Empfänger einer Träger-Mail. Bis dahin sieht die
  Personalverwaltung die Warnung im Träger-Portal.
