// Die Wanduhr des Rechners als benannte Ausnahme (#7296).
//
// Specs und ihre Helfer lesen die Uhr sonst nicht: Den Tag liefert
// `runToday()` (clock.ts), Dauern und Fristen misst `performance.now()`. Wer
// einen Wanduhr-Stempel mit einem fremden vergleichen muss (Mailpit, eine
// Dateizeit, das `exp` eines Tokens), ruft `realClock` mit dem Grund als
// String-Literal auf. Die oxlint-Regel `test-clock/no-real-clock` verlangt
// den Grund und lehnt `Date.now()` und `new Date()` unter `e2e/` ab.
// Eine .mjs-Datei, weil `network/server.mjs` sie ohne Übersetzung lädt.

/**
 * @param {string} reason Warum diese Stelle die Wanduhr braucht.
 * @returns {number} Millisekunden seit 1970.
 */
export function realClock(reason) {
  if (reason.trim() === "") {
    throw new TypeError("realClock: Der geprüfte Grund fehlt.");
  }
  return Date.now();
}
