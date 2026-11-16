---
status: proposed
---

# Nach der letzten Blockung endet die Beschäftigung des Springers über den Austritt

Vorschlag vom 16.11.2026 für
[#7197](https://github.com/moto-ogs/project-phoenix/issues/7197), Etappe der
Spec [#4611](https://github.com/moto-ogs/project-phoenix/issues/4611). Sie
setzt den Punkt um, den
[ADR 0251](0251-erstes-blocken-legt-die-beschaeftigung-des-springers-an-und-der-zugang-gilt-nur-in-zeitfenstern.md)
verschoben hat, und folgt
[ADR 0089](0089-personal-wird-beim-traeger-gefuehrt-und-in-der-schule-eingesetzt.md)
§8:

> Sie gibt Zugang nur in den geplanten Zeiten und wird danach eine frühere
> Beschäftigung. Ein späterer Einsatz ist eine Wiederaufnahme.

## Kontext

- Das erste Blocken legt an der blockenden Schule Personensatz,
  Beschäftigung und die Systemrolle `springer` an und verknüpft die
  Beschäftigung als Einsatzort (`staff_record_links.via_pool`).
- Nach der letzten Blockung bleibt die Beschäftigung aktiv. Ohne offenes
  Fenster kommt der Springer zwar nicht an die Schule, aber die Schule führt
  ihn in Personalliste, Dienstplan und Zählungen weiter.
- Der geplante Austritt (#4809) läuft schon alle fünf Minuten je Schule im
  Worker, über denselben Weg wie das sofortige Löschen, jede Person in einer
  eigenen Transaktion mit begrenzten Sperrwartezeiten (#6703).

## Entscheidung

1. **Derselbe Lauf, derselbe Austritt.** Der Worker-Job der geplanten
   Austritte beendet danach je Schule die fälligen Springer-Beschäftigungen
   (`staffoffboarding.SpringerExits`). Er nutzt die Einheit des geplanten
   Austritts und `executeAs` des Workflows. Es gibt keinen eigenen Löschweg
   und keine eigene Aufgabe im Scheduler.
2. **Fällig ist eine Beschäftigung ohne Blockung ab heute.** Workforce
   listet über `workforce.pool_due_exits` die lebenden Beschäftigungen mit
   `via_pool` an der Schule, die keine lebende Blockung ab heute (Berlin)
   haben: Die letzte Blockung ist vorbei, oder alle wurden aufgehoben. Die
   Beschäftigung endet also in der Nacht nach dem letzten Blocktag.
3. **Sperrreihenfolge wie beim Blocken.** Die Einheit sperrt zuerst die
   Personalakte (wie `pool_springer_identity`) und prüft die Fälligkeit
   erneut, dann Konto, Workforce-Sperren und Profil wie jeder Austritt. Ein
   gleichzeitiges Blocken wartet; findet der Lauf danach eine neue Blockung,
   bleibt die Beschäftigung.
4. **Im Namen der Leitung der letzten Blockung.** Der Austritt braucht ein
   Konto und eine Beschäftigung an der Schule. Er handelt für die Leitung,
   die zuletzt geblockt hat und noch an der Schule arbeitet. Gibt es keine
   mehr, handelt er im Namen der Beschäftigung des Springers selbst. So
   bleibt kein Austritt liegen, weil eine Leitung gegangen ist.
5. **Eine eigene Rolle der Schule hält die Beschäftigung.** Hat das Konto an
   der Schule eine Rolle außer `springer` und `guardian`, beschäftigt die
   Schule die Person selbst (ADR 0251 Punkt 6). Der Lauf lässt sie stehen.
6. **Die Springer-Rolle hält das Konto.** Der Austritt sperrt ein Konto
   sonst, wenn es an keiner anderen Schule aktiv ist. Ein Konto mit der
   Systemrolle `springer` an der Schule bleibt aktiv, wie eines mit einer
   Mitgliedschaft beim Träger: Der Vertrag im Pool läuft weiter, und die
   nächste Blockung braucht ein Konto, das sich anmelden kann. Das gilt auch,
   wenn eine Leitung die Beschäftigung von Hand beendet.
7. **Verlauf und Protokoll.** Workforce schreibt das Ende in den Verlauf
   der Akte (`staff_record_changes`, Art `ended`, mit Schule und dem Konto
   aus Punkt 4). Das Löschprotokoll der Schule nennt den Grund „springer
   employment ended after last block day …“.
8. **Abgelaufene Fenster räumt der Lauf mit weg.** Vor den Austritten löscht
   Identity & Access an jeder Zuordnung der Schule die Fenster, die vorbei
   sind (`PruneSpringerWindows`).
9. **Die Träger-Akte zeigt den Pool.** Ein Einsatzort mit `via_pool` trägt
   in der Akte das Merkmal „Vertretungspool“ und sagt, wann er endet oder
   dass die nächste Blockung die Person wieder beschäftigt.

Die nächste Blockung nimmt die frühere Beschäftigung wieder auf (ADR 0021,
ADR 0251 Punkt 1). Der Einsatzort bleibt dabei verknüpft.

## Verworfene Optionen

- **Einen geplanten Austritt je Springer setzen.** Er schickte der Leitung
  Hinweise zu einer Person, die sie nur geblockt hat, und bräuchte bei jeder
  Blockung und Aufhebung eine Verschiebung.
- **Eigener täglicher Lauf.** Ein neuer Scheduler-Eintrag hätte dieselbe
  Einheit, dieselben Sperren und dieselbe Meldung noch einmal gebraucht.
- **Den Austritt ohne Akteur.** Workforce und Audit erwarten eine handelnde
  Beschäftigung. Ein Systemakteur hätte beide Verträge geändert.

## Folgen

- Personalliste, Dienstplan und Zählungen der Schule führen den Springer
  nach der letzten Blockung nicht mehr.
- Der Austritt beendet die Sitzungen des Kontos (wie jeder Austritt). Der
  Lauf trifft die Nacht nach dem letzten Blocktag; der Springer meldet sich
  am nächsten Morgen neu an.
- Eine Beschäftigung, die eine Aufsicht hält, wartet wie ein blockierter
  Austritt auf den nächsten Lauf.
- Eine Beschäftigung mit eigener Rolle der Schule prüft jeder Lauf wieder.
  Das kostet je Springer drei kurze Abfragen und schreibt nichts.
