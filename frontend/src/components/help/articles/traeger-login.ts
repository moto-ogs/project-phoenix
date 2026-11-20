import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

// Portal "moto schule" (#2207). Geruest nach der echten Navigation des
// Schul-Portals (`SCHOOL_PRIMARY_NAV`): Klassenansicht, Meine Aufsichten,
// Nachrichten, Tagesinformationen, Kalender.
//
// Eine Lehrkraft sieht bewusst wenig: ihre Klassen und ihre eigenen
// Aufsichten. Abhol- und Notfallkontakte gibt es nur zu den Kindern einer
// laufenden Aufsicht. Deshalb wird hier nichts mit der Betreuung geteilt.
//
// Die Ablaeufe sind noch nicht Schritt fuer Schritt gegen die App geprueft,
// deshalb bleiben es Entwuerfe.
/**
 * `/traeger/login` (#4649): eigene Adresse, danach die Liste der Schulen.
 * Der Code per E-Mail ist Pflicht, beim ersten Mal mit Einrichtung (#4651).
 * „Passwort vergessen?“ schickt den Link auf den Träger-Host (#5149).
 */
export function traegerLoginTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerLogin,
    title: "Im Träger-Portal anmelden",
    question: "Wie melde ich mich im Träger-Portal an?",
    summary:
      "Das Träger-Portal hat eine eigene Adresse. Dort siehst du alle Schulen deines Trägers.",
    group: "einstieg",
    audience: "traeger",
    icon: "Building2",
    requirements: [
      "Du gehörst zum Träger-Büro. Du hast eine Einladung angenommen, oder das moto-Team hat dein Konto zugeordnet.",
      "Zugriff auf dein E-Mail-Postfach. Bei der Anmeldung kommt ein Code per E-Mail.",
    ],
    steps: [
      "Öffne die Adresse des Träger-Portals.",
      "Trage deine `E-Mail-Adresse` ein.",
      "Trage dein `Passwort` ein.",
      "Wähle `Anmelden`.",
      "Gehörst du zu mehreren Trägern? Wähle den Träger aus.",
      "Wähle dann `Träger öffnen`.",
      "moto zeigt die `Code-Eingabe`. Öffne die E-Mail von moto.",
      "Gib den sechsstelligen Code ein.",
      "Ist es dein eigenes Gerät? Wähle `Ja, merken und anmelden`. Dort fragt moto dann 90 Tage lang keinen Code ab.",
      "Nutzen mehrere Personen das Gerät? Wähle `Nein, nur anmelden`.",
    ],
    result: "moto öffnet die Seite `Schulen` mit allen Schulen deines Trägers.",
    notes: [
      "Lege dir die Adresse als Lesezeichen an.",
      "Die Liste der Schulen lädst du über das Drei-Punkte-Menü oben rechts herunter. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
      "Ein neues Passwort gilt auch für dein Konto in der OGS.",
    ],
    differences: [
      "Oben steht `Willkommen im Träger-Portal`. So erkennst du, dass du richtig bist.",
      "Hast du auch ein Konto in einer OGS? Dann nutzt du dasselbe Konto. Ein zweites Passwort brauchst du nicht.",
      "Meldest du dich zum ersten Mal an? Dann richtest du den Code zuerst ein. Wähle `Code an meine E-Mail senden`. Gib danach den Code ein. Wähle `Weiter zum Dashboard`.",
      "Der Code ist im Träger-Portal immer Pflicht. Nur auf einem gemerkten Gerät fragt moto ihn 90 Tage lang nicht ab.",
      "Ein gemerktes Gerät gilt nur für das Träger-Portal und nur für diesen Träger. In einer OGS merkst du das Gerät dort noch einmal.",
      "Gemerkte Geräte stehen unter `Konto` bei `Meine vertrauten Geräte`. Dort entfernst du ein Gerät wieder.",
      "Am Computer stehen die Bereiche links in der Navigation. Auf dem Handy stehen sie unten. Was dort keinen Platz hat, findest du unter `Mehr`.",
      "Am Computer stehen die Bereiche in Gruppen wie `Übersicht` oder `Finanzen`. Wähle den Namen einer Gruppe, um sie zu- oder aufzuklappen. moto merkt sich das. Die Gruppe der Seite, auf der du bist, bleibt immer offen.",
      "`Einstellungen` steht unten in der Navigation. Ein Klick darauf zeigt dort die Einstellungen. `Zurück zur App` führt zurück.",
    ],
    troubleshootingDetails: [
      "Keine E-Mail mit Code? Schau im Spam-Ordner nach. Wähle sonst `Neuen Code anfordern`.",
      "Zu oft einen falschen Code eingegeben? Warte 15 Minuten. Oder frag das moto-Team, ob es den Code zurücksetzt. Dann richtest du ihn bei der nächsten Anmeldung neu ein.",
      "Kein Zugriff mehr auf deine E-Mails? Wende dich an das moto-Team.",
      "moto sagt, dein Konto habe keinen Zugang zum Träger-Portal? Wende dich an das moto-Team.",
      "moto meldet dich ab und lässt dich nicht wieder hinein? Dann ist der Zugang deines Trägers ausgeschaltet. Wende dich an das moto-Team.",
      "Eine Schule fehlt in der Liste? Das moto-Team ordnet die Schulen deinem Träger zu.",
      "moto sagt `Die E-Mail-Adresse oder das Passwort stimmt nicht.`? Prüfe beides und versuche es erneut.",
      "Passwort vergessen? Wähle `Passwort vergessen?`. Trage deine E-Mail-Adresse ein und wähle `Link senden`. Öffne den Link aus der E-Mail und lege ein neues Passwort fest.",
      "Keine E-Mail zum Zurücksetzen? Schau im Spam-Ordner nach. Kommt keine, gehört dein Konto nicht zum Träger-Büro. Wende dich an das moto-Team.",
    ],
    related: [HELP_TOPICS.errorMessages],
  };
}
