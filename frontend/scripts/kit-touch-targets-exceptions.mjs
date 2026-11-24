// Dauerhafte Ausnahmen der Trefferflächen-Prüfung (#8060, Regel aus #8059).
// Anders als die Liste bekannter Verstöße (kit-touch-targets-known.json)
// sollen sie nie verschwinden. Neue Ausnahmen nur mit Begründung.
//
// Arten:
// - `kit-ausnahme`: bewusste Ausnahme der Kit-Regel (Stempel-Knöpfe und
//   Pausen-Stepper der Zeiterfassung, Monats-Chips der Eltern;
//   .claude/rules/frontend-ui-kit.md, „Deliberate exceptions“).
// - `abstand-24`: Das Element hat rundum mindestens 24 px Abstand zum
//   nächsten Bedienelement, weil 44 px das Layout sprengen. Die Prüfung misst
//   den Abstand nach; wird er kleiner, schlägt sie trotz Ausnahme fehl.
//
// Ohne Eintrag ausgenommen, weil die Messung sie gar nicht erst prüft: Links
// im Fließtext, vom Browser gezeichnete Felder (Datei, Regler, Farbe),
// Beschriftungen von Textfeldern, Hintergründe von Dialogen.
//
// Eintrag: { story, width?, target, problem: "small", kind, reason }.
// `target` und `story` wie in der Fehlermeldung der Prüfung; ohne `width`
// gilt die Ausnahme für Telefon und Tablet.

/** @type {ReadonlyArray<import("./kit-touch-targets-lib.mjs").TouchException>} */
export const touchTargetExceptions = [];
