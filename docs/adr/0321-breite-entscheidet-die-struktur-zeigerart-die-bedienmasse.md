---
status: accepted
---

# Breite entscheidet die Struktur, Zeigerart die Bedienmaße

Entscheidung vom 24.11.2026 zu
[#8051](https://github.com/moto-ogs/project-phoenix/issues/8051), Epic
[#7796](https://github.com/moto-ogs/project-phoenix/issues/7796) (Darstellung
auf dem iPad). Sie gilt für alle Portale und ist die Grundlage der Handy-Reihe
([#7788](https://github.com/moto-ogs/project-phoenix/issues/7788),
[#7789](https://github.com/moto-ogs/project-phoenix/issues/7789),
[#7790](https://github.com/moto-ogs/project-phoenix/issues/7790),
[#7792](https://github.com/moto-ogs/project-phoenix/issues/7792)).

## Kontext

- Das Personal arbeitet am Telefon und am iPad, Schulleitung und Träger am
  Desktop. Das iPad liegt mit 744 bis 1376 CSS-Pixeln Breite zwischen beiden.
- Die Dichte-Stufe `compact` (#2824, `frontend/src/styles/globals.css`)
  griff allein nach Breite und Höhe: von `md` bis unter `lg` und bei höchstens
  900 px Höhe. Ein iPad quer (1180 × 688) und ein iPad Pro 13" quer
  (1376 × 900) bekamen damit die dichten Desktop-Maße für die Maus.
- Für den Finger gibt es schon die Tailwind-Variante `pointer-coarse:`: Kit-
  Knöpfe sind dort mindestens 44 px hoch (Fingerregel in
  `.claude/rules/frontend-ui-kit.md`). `compact` verkleinert dieselben
  Flächen wieder. Beide Regeln trafen auf dem iPad zugleich zu.

## Messung im iOS-Simulator

Xcode 27.2, iOS-Simulator mit iPadOS 27.2, Safari. Eine Prüfseite las die
Werte per `matchMedia`; gedreht wurde per XCUITest
(`XCUIDevice.orientation`). Viewport in CSS-Pixeln, Höhe mit eingeblendeter
Safari-Leiste.

| Gerät | Viewport | `pointer` | `any-pointer` | `hover` / `any-hover` | Navigation | Tabellen | Blatt/Popover | `compact` vorher | `compact` jetzt |
|---|---|---|---|---|---|---|---|---|---|
| iPad (A16) hoch | 820 × 1048 | coarse | coarse, nicht fine | none / none | untere Leiste (`< lg`) | Tabelle | Popover | ja | nein |
| iPad (A16) quer | 1180 × 688 | coarse | coarse, nicht fine | none / none | Seitenleiste (`≥ lg`) | Tabelle | Popover | ja | nein |
| iPad mini (A20 Pro) hoch | 756 × 1072 | coarse | coarse, nicht fine | none / none | untere Leiste | Karten (`< md`) | Popover | nein | nein |
| iPad Pro 13" (M5) quer | 1376 × 900 | coarse | coarse, nicht fine | none / none | Seitenleiste | Tabelle | Popover | ja (Höhe ≤ 900) | nein |

`navigator.maxTouchPoints` ist überall 5. Der User-Agent meldet einen Mac
(„Macintosh; Intel Mac OS X“); er taugt nicht zur Erkennung.

**Offen, nicht gemessen:**

- **Split View.** Der Simulator läuft hier ohne Oberfläche; iPadOS 27 teilt
  Fenster nur per Geste oder Fenstermenü, nicht per Kommando. Die Zeigerart
  hängt am Gerät, nicht am Fenster; erwartet wird `pointer: coarse` bei
  schmalerer Breite. Die Struktur folgt dann der Breite wie oben.
- **Trackpad und Maus am iPad.** Lässt sich im Simulator nicht per Kommando
  anschließen. Erwartet: `any-pointer: fine` kommt hinzu, der Hauptzeiger
  bleibt `coarse`. Nach dieser Entscheidung behält das iPad dann die
  Fingermaße.

## Entscheidung

1. **Die Breite entscheidet die Struktur.** Navigation, Tabelle oder Karten,
   Blatt oder Popover, Spalten und Raster schalten nur an den Tailwind-
   Grenzen `sm`, `md`, `lg` (`below`/`atLeast`/`between` in
   `frontend/src/lib/hooks/use-media-query.ts`). Es bleibt bei Blatt statt
   Popover unter `sm` (#7788) und Karten statt Tabelle unter `md` (#7789).
2. **Die Zeigerart entscheidet die Bedienmaße.** Trefferflächen, Knopf- und
   Feldhöhen, Abstände zwischen Bedienelementen und die Dichte `compact`
   richten sich nach `pointer: coarse` (Finger) oder `pointer: fine` (Maus,
   Trackpad).
3. **`compact` greift nur mit feinem Zeiger.** Die Bedingung ist die bisherige
   (`md` bis unter `lg` oder höchstens 900 px hoch) und zusätzlich
   `(pointer: fine)`. Ein iPad bekommt die normale Dichte mit Fingermaßen.
   Desktop mit Maus bleibt unverändert dicht.
4. **Kriterium ist der Hauptzeiger.** `pointer`, nicht `any-pointer` und nicht
   `hover`: Ein Laptop mit Touchscreen bleibt fein, ein iPad mit Trackpad
   bleibt grob. In CSS gelten `pointer-coarse:` und `pointer-fine:`, in JS
   `COARSE_POINTER` und `FINE_POINTER` aus `use-media-query.ts`. Kein
   eigener Tailwind-Alias (`touch:`, `mouse:`).
5. **Keine iPad-Klasse.** Keine Grenzen eigens für das iPad, keine Regeln nach
   Ausrichtung (`orientation`) und keine Erkennung per User-Agent. Ein iPad
   hoch und quer ist dasselbe Gerät mit anderer Breite.
6. **Keine Funktion nur per Hover.** Was beim Überfahren erscheint, ist auch
   per Tippen und Tastatur erreichbar. `hover: none` meldet jedes iPad.

## Verworfene Optionen

- **iPad wie Telefon behandeln** (eigene Grenze bei 1024 oder 1376 px):
  verschenkt Platz auf dem Gerät mit der zweitgrößten Fläche und braucht
  eine Grenze, die nur für ein Gerät existiert.
- **iPad wie Desktop** (bisheriger Stand quer): 32-px-Knöpfe und dichte
  Abstände unter dem Finger, im Widerspruch zur Fingerregel.
- **`any-pointer: fine` als Kriterium:** schaltet das iPad auf Mausmaße,
  sobald eine Tastatur mit Trackpad angesteckt ist, obwohl weiter meist mit
  dem Finger bedient wird.
- **Regeln nach Ausrichtung:** Hoch und quer würden sich anders bedienen,
  obwohl dieselbe Hand dasselbe Gerät hält.

## Folgen

- iPads ab 768 px Breite (hoch und quer) und das iPad Pro quer werden
  etwas luftiger; Inhalte, die bisher nur durch `compact` auf eine Höhe
  passten, scrollen früher.
- Bausteine mit eigenen Fingermaßen stellen #7790 (Bedienelemente) und
  #7792 (Abstände) um; diese Entscheidung ändert keinen Baustein einzeln.
- Neue Regeln für Bedienmaße schreiben `pointer-coarse:`/`pointer-fine:`,
  nicht `max-lg:` oder `compact:` allein.
- `pointer-density.test.ts` prüft die Konstanten und die `compact`-Bedingung
  mit den gemessenen iPad-Viewports.
