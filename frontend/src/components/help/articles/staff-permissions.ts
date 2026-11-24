import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Rollen unter `/database/roles`, Rechteliste unter `/database/permissions`.
 * Rollen des Trägers (`role.fromTraeger`, #4810) und
 * vorgegebene Rollen (`role.isSystem`) haben keine Kopfaktionen
 * (roles-master-detail.tsx). Eine neue Rolle startet mit den Rechten ihrer
 * Vorlage; gesperrte Rechte bietet der Reiter nicht an (#4574).
 */
export function staffPermissionsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadStaffPermissions,
    title: "Mitarbeitende und Rechte verwalten",
    question: "Wie lege ich fest, was eine Person sehen darf?",
    summary: "Jede Person hat eine Rolle. Die Rolle trägt die Rechte.",
    group: "personal",
    audience: "lead",
    icon: "ShieldCheck",
    steps: [],
    instructionGroups: [
      {
        title: "Eine eigene Rolle anlegen",
        steps: [
          "Öffne `Datenverwaltung` und danach `Rollen`.",
          "Wähle oben rechts `+ Rolle`.",
          "Trage `Name` und `Beschreibung` ein.",
          "Wähle eine `Vorlage`: `Wie Betreuung`, `Wie Verwaltung` oder `Wie Lehrkraft`.",
          "Wähle `Erstellen`.",
        ],
      },
      {
        title: "Die Rechte einer Rolle ändern",
        steps: [
          "Öffne `Rollen` und wähle die Rolle aus der Liste.",
          "Öffne den Reiter `Berechtigungen` und wähle `Bearbeiten`.",
          "Hake an, was die Rolle dürfen soll.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Die Rolle einer Person ändern",
        steps: [
          "Öffne `Datenverwaltung` und danach `Personal`.",
          "Wähle die Person aus der Liste.",
          "Öffne den Reiter `Konto` und wähle `Bearbeiten`.",
          "Wähle bei `Rolle` die neue Rolle und dann `Speichern`.",
        ],
      },
    ],
    result:
      "Die neue Rolle gilt, sobald sich die Person das nächste Mal anmeldet.",
    notes: [
      "Eine neue Rolle bekommt einmal die Rechte ihrer Vorlage. Danach änderst du die Rechte nur noch an der Rolle selbst.",
      "`Wie Verwaltung` gibt fast alle Rechte der Verwaltung. Einiges kann nur die Rolle `Verwaltung` selbst, zum Beispiel Mitteilungen an Eltern schreiben.",
      "Eine Rolle aus `Wie Lehrkraft` arbeitet wie die Rolle `Lehrkraft` in moto schule. Wer sie hat, meldet sich dort an. Später lässt sie sich nicht gegen eine andere Rolle tauschen.",
      "Bei manchen Rechten steht ein Hinweis. Damit kann eine Person Rollen, Konten oder Einstellungen ändern. Gib diese Rechte nur der Leitung.",
      "`Position` im Reiter `Konto` ist nur ein Text für die Personalliste. Sie ändert keine Rechte. Die Liste zeigt sie passend zum `Geschlecht` aus den Stammdaten, etwa `Betreuerin` statt `Betreuer`. Ohne Angabe steht `Betreuer:in`.",
      "Unter `Datenverwaltung` → `Berechtigungen` siehst du alle verfügbaren Rechte. Diese Übersicht kannst du nur ansehen. Die Rechte einer eigenen Rolle änderst du unter `Rollen`.",
      "Die Rolle entscheidet auch darüber, welche Menüpunkte jemand sieht.",
      // ADR 0091: die zwei Zugangsstufen externer Personen sind feste Rollen.
      "`AG-Leitung` ist für Personen, die eigene Termine betreuen. Sie sieht unter `Heute` nur ihre eigenen Termine. Dort startet sie den Termin, checkt die Kinder ein und aus und beendet ihn.",
      "`Gast` ist für Personen, die nur zuschauen. Sie sieht Kinder, Räume und AGs. Elterndaten, Nachrichten und Telefonnummern der Eltern sieht sie nicht. Ändern kann sie nichts.",
      "Mit `AG-Leitung` oder `Gast` sieht die Person keine Zeiterfassung, keine Einstellungen und kein Personal.",
    ],
    differences: [
      "moto bringt einige Rollen schon mit: `Verwaltung`, `Betreuung`, `Lehrkraft`, `Schulverwaltung`, `AG-Leitung` und `Gast`. Sie sind als `Vorgegeben` markiert.",
      "Bei einer vorgegebenen Rolle fehlen `Bearbeiten` und `Löschen`. Zum Ändern von Rechten lege deshalb eine eigene Rolle an.",
      "Eine Rolle trägt den Vermerk `Vom Träger`: Dein Träger gibt sie für alle seine Schulen vor. Du gibst sie Personen wie jede andere Rolle. `Bearbeiten` und `Löschen` fehlen, das macht das Träger-Büro.",
      "Einige Rechte stehen nicht zur Auswahl. Sie gehören nur der Rolle `Verwaltung` oder dem moto-Team.",
    ],
    troubleshootingDetails: [
      "Eine Person sieht einen Bereich nicht? Prüfe die Rechte ihrer Rolle.",
    ],
    related: [
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadMissingMenu,
      HELP_TOPICS.leadTeacherAccess,
    ],
  };
}
