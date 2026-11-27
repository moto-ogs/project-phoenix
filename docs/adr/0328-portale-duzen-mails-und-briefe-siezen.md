---
status: accepted
---

# Die Portale sagen „du“, Mails und Briefe sagen „Sie“

Entscheidung vom 27.11.2026. Sie löst
[ADR 0294](0294-moto-spricht-alle-nutzer-mit-du-an.md) ab.

## Kontext

Bis zum 18.11.2026 standen die Texte in der Sie-Form. ADR 0294 stellte dann
jeden Text, den moto schreibt, auf „du“ um, auch E-Mails und Briefvorlagen.
Innerhalb weniger Tage fragten mehrere Kunden, wie sie Mails und Schreiben
wieder auf „Sie“ stellen. Eine Rechnung, ein Gebührenbescheid oder ein
Vertragsschreiben geht an Familien, die den Träger nicht kennen, und wird oft
ausgedruckt und abgeheftet. Dort wirkt „du“ unpassend. Im Portal dagegen
arbeiten Eltern und Personal täglich mit moto; dort passt das „du“.

Diese ADR ist die einzige Regel für die Anrede. ADR 0294 gilt nicht mehr und
verweist nur noch hierher.

## Entscheidung

1. **Die Grenze ist der Kanal, nicht die Person.** Innerhalb der Portale
   bleibt moto beim „du“: alle Portale (Schule, Träger, Eltern, Operator),
   Kiosk, Fehlermeldungen, Hilfe, In-App- und Push-Mitteilungen. Was moto
   verschickt, spricht mit „Sie“ an: jede E-Mail und jedes Schreiben, das moto
   schreibt (Bestätigung, Rechnung, Gebührenbescheid, Vertragsschreiben,
   Storno, Gutschrift, Aufhebungs- und Änderungsbescheid) mit den festen
   Bausteinen, die moto einsetzt (Zahlungshinweis, Lastschrift, QR-Code,
   Rückfragen, Notfallnummern). Dazu gehören die Standardtexte der Bestätigungen
   und Mitteilungen zum Betreuungsvertrag (Kündigung, Widerruf, Vertragsende),
   auch wo die Eltern-App dasselbe Schreiben zeigt: Es ist Korrespondenz,
   kein Portaltext.
2. **Auch Personal bekommt „Sie“.** Einladungen, Passwort-Reset,
   Anmeldecodes, Abwesenheitsanträge, Nachweis-Erinnerungen und
   Lohnexport-Mails an Schul- und Träger-Personal, Caterer und Operator stehen
   in der Sie-Form. Löst dasselbe Ereignis eine Mail und eine Push- oder
   In-App-Mitteilung aus, steht die Mail in der Sie-Form und die Mitteilung in
   der Du-Form.
3. **Schreibweise.** „Sie“, „Ihr“, „Ihre“, „Ihnen“ stehen groß. Ein Schreiben
   an eine Familie oder an beide Eltern sagt ebenfalls „Sie“; „ihr“ als Anrede
   gibt es in Mails und Briefen nicht mehr.
4. **Begrüßung ohne Vorname plus „Sie“.** Wo eine Mail die selbst gewählte
   Anrede nutzt (heute Elternnachrichten und Termine), beginnt sie mit „Liebe
   Frau Klein,“ oder „Lieber Herr Klein,“. Ohne
   Anrede oder ohne Nachnamen bleibt sie neutral: „Guten Tag Karin Klein,“.
   Eine Begrüßung nur mit Vornamen („Hallo Karin,“) wird zu „Guten Tag Karin
   Klein,“. So folgt auf einen Vornamen nie ein „Sie“
   („Liebe Karin, … Sie“). Briefe an die Familie beginnen weiter mit „Liebe
   Familie Klein,“, Mails ohne Namen weiter mit „Hallo,“ oder „Guten Tag,“.
5. **Brief an eine andere zahlende Person.** Auch er sagt „Sie“ und grüßt die
   Person mit Namen. Er nennt das Kind und den Vertrag weiter nicht ihr
   eigenes („das Kind“, „dem Vertrag“); dafür bleibt die eigene Fassung des
   Standardtexts der Bestätigung. Rechnung und Gebührenbescheid haben für
   diese Person keinen eigenen Text mehr, weil er mit „Sie“ gleich lautet.
6. **Ton bleibt freundlich und sachlich.** `moto-einfache-sprache` gilt
   unverändert.
7. **Kein Schalter je Träger.** moto bietet keine Wahl zwischen „du“ und
   „Sie“ an.

## Ausnahmen

- Texte, die Schulen oder Träger selbst gespeichert haben (eigene Vorlagen,
  eigener Zahlungshinweis, eigene Hinweise, Rechtstexte, Nachrichten), ändert
  moto nicht, auch nicht durch eine Datenmigration. Eine gespeicherte Kopie
  eines früheren Standardtexts ist eine eigene Vorlage und behält ihren
  Wortlaut.
- Bereits ausgestellte Schreiben behalten ihr PDF.
- Zitierte Texte Dritter und gesetzlich vorgegebene Wortlaute bleiben
  wörtlich (Muster-Widerrufsbelehrung, SEPA-Mandatstext).
- Versionierte Einwilligungs- und Erklärungstexte, denen Personen schon
  zugestimmt haben, bleiben wörtlich. Eine andere Anrede braucht eine neue
  Version.
- Standardhinweise, die mit ihrem Wortlaut in Nachweise und gespeicherte
  Formularvorlagen eingehen (E-Mail-Kontakt im Anmeldeformular), bleiben
  wörtlich.
- Ein Text, den moto als Inhalt einer Mitteilung speichert (der
  Standardtext einer Umfrage), ist Portal-Text und bleibt in der Du-Form.
- Die übrigen Sprachen, PyrePortal und der Kiosk folgen dieser ADR nicht;
  sie behalten ihre Anrede.

## Folgen

Ein Portal-Text, der zeigt, wie ein Schreiben oder eine Mail lautet (die
Vorschau der Annahme-Mail, der Standard-Zahlungshinweis in den Einstellungen,
die Vorschau eines Bescheids), steht wie das Schreiben in der Sie-Form.

Eine Mail, die schon in der Warteschlange steht, behält ihren Betreff; ihr
Text entsteht beim Versand aus der aktuellen Vorlage.

`scripts/check-anrede.mjs` prüft beide Richtungen: „Sie“ in Portal-Texten,
„du“ und „ihr“ in den Mail-Vorlagen und in den Go-Dateien seiner Liste
`OUTGOING`, die Mails und Briefe schreiben. Ein gebundener Wortlaut trägt den
Kommentar `sie-anrede-erlaubt (ADR 0328): <Grund>` im Portal-Text oder
`du-anrede-erlaubt (ADR 0328): <Grund>` im ausgehenden Text; ein Mailtext in
einer Go-Datei, die auch Portal-Texte enthält, trägt den ersten. Die Regel für
Texte steht in `.agents/skills/moto-einfache-sprache/SKILL.md`; die
Verständlichkeits- und Hilfe-Regeln verweisen darauf.
