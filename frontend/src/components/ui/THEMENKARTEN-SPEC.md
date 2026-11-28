# Themenkarten: wann ein Kartenkopf ein Symbol trägt

Regel aus Spec #8220 (Grilling zu #8133, 26.11.2026). Kurzfassung und Kit-Bezug:
[`.claude/rules/frontend-ui-kit.md`, Kartenkopf](../../../../.claude/rules/frontend-ui-kit.md#kartenkopf-themenkarten).

## Regel

Eine Karte trägt ein Konzept-Symbol genau dann, wenn sie eine **Themenkarte** ist:

1. Sie steht direkt auf der Seite oder direkt in einem Reiter, nicht in einer
   anderen Karte, nicht in Dialog, Seitenpanel oder Assistent.
2. In derselben Ansicht steht mindestens eine weitere Themenkarte.
3. Sie hat ein eigenes Thema.

Dann tragen alle Themenkarten der Ansicht ein Symbol. Auf Übersichts-, Detail-
und Einstellungsseiten hilft es beim Überfliegen; in Arbeitsabläufen (Anlegen,
Import, Assistent) und bei Einzelkarten bleibt der Kopf ohne Symbol.

## Begriffe

- **Ansicht:** eine Seite ohne Reiter oder ein einzelner Reiter. Was gleichzeitig
  sichtbar ist, zählt zusammen: eine Karte im Seitenrumpf über den Reitern
  zählt zu jedem Reiter.
- **Themenkarte:** eine Karte nach der Regel oben. Gezählt wird nach Aufbau: die
  volle Ansicht für eine Person mit allen Rechten und vollständigen Daten, nicht
  der gerade sichtbare Zustand. Keine Laufzeit-Logik für Symbole; eine Seite
  sieht gleich aus, egal welche Karten gerade Daten haben.
- **Datensatz-Karte:** eine Karte, deren Zahl an Daten hängt (je Raum, Schule,
  abrechnende Stelle, Woche, Frage, Person, Gruppe, Tag). Kein Symbol, zählt
  nicht als Nachbar. Karten aus einer festen Liste im Code (Dokumentarten,
  Einstellungs-Kategorien, feste Varianten wie KOST1/KOST2) sind Themenkarten.
- **Formular** (eng): Anlegen- oder Bearbeiten-Ablauf eines Objekts,
  Import-Schritte (Zuordnung, Vorschau, Protokoll), Assistent-Schritte.
  Einstellungsseiten, Detailseiten mit Inline-Bearbeiten,
  Abrechnungs-Einstellungen und Profil sind kein Formular.
- **Statussymbol:** zeigt einen Zustand (Warnung, gesperrt, erledigt), kein
  Thema. Es bleibt erhalten (`leading`) und wird nicht durch ein Konzept
  ersetzt, z. B. das Warndreieck der Hinweiskarten.

## Sonderfälle

- **Startseite** (`/home`): Blöcke tragen immer ein Symbol, auch als einzelner Block.
- **Kachel auf Seitenebene:** eine Karte als Kopf einer klickbaren Kachel
  („Unterwegs“ neben den Raumkarten) zählt wie eine Karte auf Seitenebene.
- **Konzept mehrfach:** dasselbe Konzept darf in einer Ansicht mehrfach
  vorkommen; kein neues Konzept nur zur Unterscheidung.
- **Hüllkarten der Anmelde-Detailseiten** bleiben unverändert: alles darin ist
  verschachtelt und ohne Symbol (Umbau in #8218).
- **Gleichzeitig sichtbar zählt zusammen:** die Karte über den Reitern
  („Angaben aus der Ferienanmeldung“ am Kind) und die Karten im Reiter werden
  gleich behandelt.

## Im Code

- Das Symbol kommt nur über `concept` am `SectionCard`-Kopf, aus
  `lib/concepts/<key>.ts`. `leading` nur für Statussymbole und begründete
  Sonderfälle (Avatar); ein von Hand gebautes Konzept-Kästchen wird zu `concept`.
- Einrückung und Größe des Kartenkopfs bleiben: nur Titel und Beschreibung
  rücken neben das Symbol.
- **Einstellungs-Kategorien:** `SettingsCategory withIcon tabKey` holt das
  Konzept aus `CATEGORY_CONCEPTS`
  (`components/settings/settings-category-concepts.ts`); eine Kategorie ohne
  Eintrag trägt das Konzept ihres Reiters.
- **Geteilte Karten,** die in Ansichten mit unterschiedlicher Entscheidung
  stehen, haben den Schalter `withIcon` (Standard aus, das Konzept steht fest in
  der Komponente): `SettingsCategory`, `TrustedDevicesSection` (Geräte),
  `RequestMailStatus` (Mails), `SepaMandateStatusCard`/`SepaMandateStatusView`
  (Lastschrift). Jede Seite setzt den Wert nach ihrer Ansicht.

## Beispiele

**Mit Symbol:** Eine Kontoseite zeigt „Anmeldung“, „Vertraute Geräte“ und
„Darstellung“ direkt auf der Seite: drei Themenkarten mit eigenem Thema, also
trägt jede ihr Konzept.

```tsx
<SectionCard concept={signInConcept} title="Anmeldung">…</SectionCard>
<TrustedDevicesSection scope="traeger" withIcon />
<SectionCard concept={displayConcept} title="Darstellung">…</SectionCard>
```

**Ohne Symbol:** Ein Assistent zum Anlegen eines Objekts zeigt in jedem
Schritt Karten mit Feldern. Das ist ein Formular im engen Sinn: kein Kopf trägt
ein Themensymbol. Ein Warnhinweis darin behält sein Warndreieck als
Statussymbol.

```tsx
<SectionCard title="Angaben">…</SectionCard>
<SectionCard leading={<WarningIcon … />} title="Daten fehlen">…</SectionCard>
```
