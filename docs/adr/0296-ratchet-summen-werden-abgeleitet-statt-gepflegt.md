---
status: accepted
---

# Ratchet-Summen werden abgeleitet statt gepflegt

Entscheidung für [#7461](https://github.com/moto-ogs/project-phoenix/issues/7461).
Sie ergänzt [ADR 0057](0057-only-the-target-is-a-rule.md) Punkt 5.

## Kontext

Die Register der Quell-Ratchets in `backend/test/` hatten neben ihren
Einträgen je eine von Hand gepflegte Summe: `moduleComposeBudgetTotal`,
`moduleLegacyFileBudgetTotal`, `moduleLegacyBudgetTotal`,
`modulePassthroughOwnerBudgetTotal` und `moduleComposeAliasBudgetTotal`.
Jeder Pull Request, der ein Paket eines Registers änderte, musste auch diese
eine Zeile ändern. In 30 Tagen änderten 193 Commits auf `development`
`moduleComposeBudgetTotal` und 112 `modulePassthroughOwnerBudgetTotal`.
Parallele Pull Requests kollidierten dort ohne inhaltlichen Streit, und zwei
für sich korrekte, parallel gemergte Senkungen ließen `development` rot, weil
der Test auch bei Luft in der Summe scheitert.

Die Summe prüft nichts, was die Einträge nicht schon prüfen. Jeder Eintrag ist
exakt: Der Test scheitert, wenn gemessener Wert und Eintrag abweichen, wenn
ein gemessener Schlüssel keinen Eintrag hat und wenn ein Eintrag nichts mehr
misst. Damit ist die gemessene Summe gleich der Registersumme.
`scripts/backend-architecture.sh check` vergleicht die Registersumme schon
heute mit der Basis des Pull Requests, so dass ein neuer oder verschobener
Eintrag nichts hinzufügen kann, was ein bestehender nicht darf.

## Entscheidung

1. Die fünf Summen-Konstanten entfallen. Der Ratchet-Test prüft nur noch die
   Einträge. Die Registersumme gegen die Basis prüft weiter
   `scripts/backend-architecture.sh check`.
2. Eine Erhöhung nennt ihre neue ADR im Kommentar des erhöhten oder neuen
   Eintrags. Ein Zitat im Kommentar über dem Register erlaubt nichts mehr:
   Es hätte jeden Eintrag des Registers freigegeben, und diesen Kommentar
   ändern alle Pull Requests eines Registers.
3. Luft bleibt je Eintrag ein Fehler. Zwei Pull Requests, die denselben
   Eintrag ändern, kollidieren schon in Git. Den Fall, dass beide denselben
   neuen Wert setzen und Git sie ohne Konflikt zusammenführt, nehmen wir in
   Kauf. Ein Test, der sich auf `development` anders verhält als im Pull
   Request, würde mehr Schaden anrichten.

## Folgen

- Pull Requests, die verschiedene Einträge eines Registers ändern,
  kollidieren nicht mehr an einer gemeinsamen Summenzeile. Git kann nur noch
  bei direkt benachbarten Einträgen einen Konflikt melden. Die Gesamtsumme kann auf
  `development` nicht mehr rot werden, weil es sie nicht mehr gibt.
- Eine ADR, die ein Register erhöht, nennt die Erhöhung des Eintrags und
  keine Summe mehr.
- Erhöhungen ohne neue ADR scheitern weiter in
  `scripts/backend-architecture.sh check`, weil Eintrag oder Registersumme
  über der Basis liegen. Der Test scheitert, solange der Eintrag nicht zum
  Messwert passt; das galt vorher genauso, wenn Eintrag und Summe zusammen
  erhöht wurden.
