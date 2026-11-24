---
status: accepted
---

# Breite entscheidet Struktur und Seitenraster, Zeigerart die Bedienmaße

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
- Die Grenzen hingen bisher uneinheitlich an Breiten-Breakpoints; offen war,
  ob das iPad wie Telefon, wie Desktop oder als eigene Klasse gilt.
- Die Stufe `compact` (#2824, `frontend/src/styles/globals.css`) greift von
  `md` bis unter `lg` und bei höchstens 900 px Höhe. Sie verkleinert fast nur
  Abstände: Seitenrand, Kartenränder, Rumpf-Rhythmus. Bedienhöhen sind
  ausdrücklich ausgenommen
  (`frontend/src/components/ui/TENANT-PAGE-SPEC.md`, Abschnitt zur
  `compact`-Stufe).
- Für den Finger gibt es die Tailwind-Variante `pointer-coarse:`: Kit-Knöpfe
  sind dort mindestens 44 px hoch (Fingerregel in
  `.claude/rules/frontend-ui-kit.md`).

## Messung im iOS-Simulator

Xcode 27.2, iOS-Simulator mit iPadOS 27.2, Safari. Eine Prüfseite las die
Werte per `matchMedia`; gedreht wurde per XCUITest
(`XCUIDevice.orientation`). Viewport in CSS-Pixeln, Höhe mit eingeblendeter
Safari-Leiste.

| Gerät | Viewport | `pointer` | `any-pointer` | `hover` / `any-hover` | Navigation | Tabellen | Blatt/Popover | `compact` |
|---|---|---|---|---|---|---|---|---|
| iPad (A16) hoch | 820 × 1048 | coarse | coarse, nicht fine | none / none | untere Leiste (`< lg`) | Tabelle | Popover | ja |
| iPad (A16) quer | 1180 × 688 | coarse | coarse, nicht fine | none / none | Seitenleiste (`≥ lg`) | Tabelle | Popover | ja (Höhe) |
| iPad mini (A20 Pro) hoch | 756 × 1072 | coarse | coarse, nicht fine | none / none | untere Leiste | Karten (`< md`) | Popover | nein |
| iPad Pro 13" (M5) quer | 1376 × 900 | coarse | coarse, nicht fine | none / none | Seitenleiste | Tabelle | Popover | ja (Höhe ≤ 900) |

`navigator.maxTouchPoints` ist überall 5. Der User-Agent meldet einen Mac
(„Macintosh; Intel Mac OS X“); er taugt nicht zur Erkennung. Beim iPad Pro
schwankt die Höhe mit der Safari-Leiste zwischen 900 und 946 px, `compact`
schaltet dabei mit.

**Offen, nicht gemessen:**

- **Split View.** Der Simulator läuft hier ohne Oberfläche; iPadOS 27 teilt
  Fenster nur per Geste oder Fenstermenü, nicht per Kommando. Die Zeigerart
  hängt am Gerät, nicht am Fenster; erwartet wird `pointer: coarse` bei
  schmalerer Breite. Struktur und Seitenraster folgen dann der Breite.
- **Trackpad und Maus am iPad.** Lässt sich im Simulator nicht per Kommando
  anschließen. Erwartet: `any-pointer: fine` kommt hinzu, der Hauptzeiger
  bleibt `coarse`. Nach dieser Entscheidung behält das iPad dann die
  Fingermaße.

## Entscheidung

1. **Die Breite entscheidet Struktur und Seitenraster.** Navigation, Tabelle
   oder Karten, Blatt oder Popover, Spalten, Raster, Seitenränder und
   Abstände schalten nur an den Tailwind-Grenzen `sm`, `md`, `lg`
   (`below`/`atLeast`/`between` in `frontend/src/lib/hooks/use-media-query.ts`).
   Es bleibt bei Blatt statt Popover unter `sm` (#7788) und Karten statt
   Tabelle unter `md` (#7789).
2. **`compact` ist Seitenraster nach Breite und Höhe.** Die Bedingung bleibt
   unverändert und hängt nicht an der Zeigerart. Ohne `compact` bekäme das
   iPad nur die breiteren Desktop-Ränder, keine größeren Bedienelemente.
   Bedienhöhen gehören nicht in `compact`.
3. **Die Zeigerart entscheidet Bedienmaße und Trefferflächen.** Knopf- und
   Feldhöhen, Trefferflächen und Abstände zwischen Bedienelementen richten
   sich nach `pointer: coarse` (Finger) oder `pointer: fine` (Maus,
   Trackpad).
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
- **`compact` nur mit feinem Zeiger:** Das iPad bekäme dadurch nur breitere
  Seitenränder und Kartenabstände, keine größeren Bedienelemente; die
  regeln schon `pointer-coarse:` und die Fingerregel.
- **`any-pointer: fine` als Kriterium:** schaltet das iPad auf Mausmaße,
  sobald eine Tastatur mit Trackpad angesteckt ist, obwohl weiter meist mit
  dem Finger bedient wird.
- **Regeln nach Ausrichtung:** Hoch und quer würden sich anders bedienen,
  obwohl dieselbe Hand dasselbe Gerät hält.

## Folgen

- Keine sichtbare Änderung durch diese Entscheidung; sie legt die Regel für
  #7790 (Bedienelemente) und #7792 (Abstände) fest, die Bausteine einzeln
  umstellen.
- Neue Regeln für Bedienmaße schreiben `pointer-coarse:`/`pointer-fine:`,
  nicht `max-lg:` oder `compact:`. Neue Regeln für Ränder und Abstände
  folgen der Breite (`max-sm:`, `compact:`), nicht der Zeigerart.
- `pointer-density.test.ts` prüft die Konstanten mit den gemessenen
  iPad-Viewports.
