---
status: accepted
---

# moto spricht alle Nutzer mit Du an

Entscheidung vom 18.11.2026 zu
[#7401](https://github.com/moto-ogs/project-phoenix/issues/7401).

## Kontext

Die Texte standen bisher in der Sie-Form. Seit
[#7368](https://github.com/moto-ogs/project-phoenix/pull/7368) beginnen
Eltern-Mails mit gewählter Anrede mit „Liebe Karin,“ und fuhren mit „Sie“
fort. Begrüßungen nutzten schon vorher den Vornamen.

## Entscheidung

1. **Du überall.** Jeder Text, den moto selbst schreibt, spricht die Person mit
   „du“ an: alle Portale, Kiosk, E-Mails, Briefvorlagen, Fehlermeldungen und
   Hilfe. Das gilt für Eltern, Schul- und Träger-Personal, Caterer und das
   Operator-Portal gleich.
2. **Kleinschreibung.** „du“, „dein“, „dir“, „dich“ stehen klein, außer am
   Satzanfang.
3. **Mehrere Personen bekommen „ihr“.** Ein Text an eine Familie oder Gruppe
   („Liebe Familie Klein,“) nutzt „ihr“, „euch“, „euer“.
4. **Ton bleibt freundlich und sachlich.** Du heißt nicht flapsig: keine
   Umgangssprache, keine Ausrufe. `moto-einfache-sprache` gilt unverändert.
5. **Begrüßungen bleiben beim Vornamen.** Ohne gewählte Anrede bleibt die
   neutrale Form „Guten Tag Vorname Nachname,“.

## Ausnahmen

- Texte, die Schulen oder Träger selbst gespeichert haben (eigene Vorlagen,
  Rechtstexte, Nachrichten), ändert moto nicht.
- Zitierte Texte Dritter und gesetzlich vorgegebene Wortlaute bleiben wörtlich.
- Versionierte Einwilligungs- und Erklärungstexte, denen Personen schon
  zugestimmt haben, bleiben wörtlich. Eine Du-Fassung braucht eine neue Version.
- Standardhinweise, die mit ihrem Wortlaut in Nachweise und gespeicherte
  Formularvorlagen eingehen (E-Mail-Kontakt im Anmeldeformular), bleiben
  wörtlich.
- Die übrigen Sprachen und PyrePortal folgen in eigenen Schnitten.

## Folgen

Schreiben mit eigener Vorlage eines Trägers behalten dessen Wortlaut. Die
Bausteine, die moto einsetzt, stehen in der Ihr-Form; bis der Träger seine
Vorlage anpasst, mischt ein solches Schreiben beide Formen.

Neue und geänderte deutsche Texte stehen in der Du-Form. Die Regel steht in
`.agents/skills/moto-einfache-sprache/SKILL.md`; die Verständlichkeits- und
Hilfe-Regeln verweisen darauf.
