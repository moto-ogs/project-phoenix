// Die Uhr der Stories (#7296).
//
// Die Storybook-Tests (`vitest.setup.ts`) und der Pixelvergleich
// (`scripts/kit-pixel-stories.pw.ts`) halten `Date` auf TEST_CLOCK_INSTANT
// an. Im Storybook am Entwicklungsrechner läuft die echte Uhr: Eine Story,
// deren Daten zum Heute des Bausteins passen müssen (aktuelle Woche, „ab
// heute änderbar“), rechnet darum von `storyNow()` aus statt von einem
// festen Datum. Die oxlint-Regel `test-clock/no-real-clock` lehnt
// `new Date()` und `Date.now()` in Stories ab; dies ist die eine Stelle, die
// die Uhr für sie liest.

/** Der Zeitpunkt, auf dem die Story rendert: im Test fest, sonst jetzt. */
export function storyNow(): Date {
  return new Date();
}
