import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Das Einladen ins Elternportal. Der Weg des Teams laeuft ueber das Kind:
 * Reiter `Erziehungsberechtigte`, dann `Einladen` bei der Person
 * (student-guardian-manager.tsx). Ohne E-Mail-Adresse tut der Knopf nichts --
 * `handleInviteGuardian` bricht bei `!guardian.email` still ab.
 *
 * Die Seite `Elternzugänge` (`/admin/guardian-approvals`) ist NICHT die
 * Warteschlange fuer Einladungen des Teams. Sie sammelt nur, was Eltern
 * selbst anstossen, gesteuert von `guardians.parent_invite_mode`. Beides
 * steht hier zusammen, weil es dieselbe Frage beantwortet: wer bekommt
 * Zugang zu einem Kind. Deshalb zeigt auch das Fragezeichen dieser Seite
 * hierher.
 *
 * Eine eingeschraenkte `Portalrolle` (`Notfallkontakt`, `Nur Abholung`,
 * `Sozialdienst`) hat keinen Portalzugriff. Eine Einladung stuft sie hoch
 * und fragt vorher `Vollen Zugriff gewähren?`.
 *
 * `Eltern mit Konto benachrichtigen` (#7760, ADR 0309 Abschnitt 5) steht in
 * derselben Sammeleinladung, wenn die Auswahl Eltern mit Konto hat. Die Mail
 * geht an die Anmeldeadresse des Kontos, nennt nur Kinder mit heute gebuchter
 * Betreuung und geht je Elternteil und Kind einmal raus; der Zugang merkt
 * sich, dass sie eingeplant wurde. Einen zweiten Versand gibt es nicht.
 */
export function inviteGuardiansTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadInviteGuardians,
    title: "Eltern ins Elternportal einladen",
    question: "Wie lade ich Eltern ein?",
    summary:
      "Du lädst jede Person beim Kind ein. Dafür brauchst du ihre E-Mail-Adresse.",
    group: "elternarbeit",
    audience: "lead",
    icon: "KeyRound",
    requirements: [
      "Das Kind ist in moto angelegt.",
      "Du kennst die E-Mail-Adresse der Person.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Eine eingetragene Person einladen",
        description:
          "Meistens stehen die Eltern schon beim Kind. Dann sind es vier Schritte.",
        steps: [
          "Öffne in der Seitenleiste `Alle Kinder`.",
          "Wähle das Kind aus der Liste.",
          "Wechsle auf den Reiter `Erziehungsberechtigte`.",
          "Wähle rechts neben der Person `Einladen`.",
        ],
      },
      {
        title: "Eine Person zuerst eintragen",
        description:
          "Steht die Person noch nicht beim Kind, trage sie vorher ein. Pflicht sind nur zwei Felder.",
        steps: [
          "Wähle im Reiter `Erziehungsberechtigte` oben rechts `+ Hinzufügen`.",
          "Trage `Vorname` und `Nachname` ein.",
          "Trage unter `Kontaktdaten` die `E-Mail` ein. Ohne sie geht keine Einladung raus.",
          "Lass `Portalrolle` auf `Erziehungsberechtigte/r`.",
          "Wähle unten `Hinzufügen`.",
          "Wähle danach bei der Person `Einladen`.",
        ],
      },
      {
        title: "Alle Eltern einer Klasse einladen",
        description:
          "So lädst du die Eltern aller Kinder einer Klasse auf einmal ein, auch von Kindern ohne OGS-Platz.",
        steps: [
          "Öffne `Datenverwaltung` und danach `Kinderdaten`.",
          "Ordne die Liste nach `Klasse`.",
          "Öffne bei der Klasse das Menü mit den drei Punkten.",
          "Wähle `Eltern einladen`.",
          "Prüfe die Übersicht und bestätige.",
        ],
      },
      {
        title: "Eltern mit Konto benachrichtigen",
        description:
          "Wurden Kinder aus einem importierten Vertrag angemeldet, sehen ihre Eltern die Betreuung jetzt im Elternportal. Eltern mit Konto sagst du das mit einer kurzen E-Mail.",
        steps: [
          "Öffne `Datenverwaltung` und danach `Kinderdaten`.",
          "Wähle oben rechts das Menü mit den drei Punkten und dann `Auswählen`.",
          "Hake die Kinder an und wähle `Eltern einladen`.",
          "Setze den Haken bei `Eltern mit Konto benachrichtigen`.",
          "Prüfe die Zahlen: `Werden eingeladen`, `Bekommen die Nachricht` und `Keine E-Mail-Adresse`. Kinder, die heute keine Betreuung gebucht haben, zählt `Kinder ohne gebuchte Betreuung: keine Nachricht`.",
          "Wähle unten zum Beispiel `3 Eltern anschreiben`.",
        ],
      },
      {
        title: "Eine Anfrage von Eltern freigeben",
        description:
          "Eltern können weitere Bezugspersonen einladen, zum Beispiel eine Großmutter. Je nach Einstellung landet das erst bei dir.",
        steps: [
          "Klappe in der Seitenleiste `Eltern` auf.",
          "Öffne `Elternzugänge`.",
          "Prüfe bei der Anfrage Name und Kind.",
          "Wähle `Freigeben`.",
        ],
      },
    ],
    result:
      "Die Person bekommt eine E-Mail mit einem Link. Bei der Person siehst du, ob die Mail angekommen ist. Sobald sie ihr Passwort festlegt, sieht sie ihr Kind im Elternportal.",
    notes: [
      "Hinter dem Namen steht, wie weit die Person ist: `Kein Konto`, `Einladung offen`, `Link gilt nicht mehr` oder `Konto aktiv`.",
      "Bei `Einladung offen` heißt der Knopf `Erneut einladen`. Damit geht die E-Mail noch einmal raus.",
      "Eine Person mit mehreren Kindern lädst du nur einmal ein. Sie sieht danach alle ihre Kinder.",
      "Die Nachricht geht an die E-Mail-Adresse, mit der sich die Eltern im Elternportal anmelden. Sie nennt nur die Vornamen der Kinder, die Schule und den Weg ins Elternportal. Geschwister stehen in einer Nachricht.",
      "Die Nachricht nennt nur Kinder, die heute Betreuung gebucht haben. Buchungen, die erst später beginnen, zählen nicht, ein Wochenplan allein auch nicht. Jedes Elternteil bekommt sie pro Kind nur einmal. Wurde sie schon verschickt, steht das Elternteil unter `Nachricht schon verschickt`.",
      "Holt jemand das Kind nur ab, wähle `Portalrolle` `Nur Abholung`. Dann sind `E-Mail` und Telefon freiwillig. Die Person bekommt keinen Zugang zur Eltern-App.",
    ],
    differences: [
      "`Eltern mit Konto benachrichtigen` fehlt? Dann hat in der Auswahl niemand ein Konto. Eltern ohne Konto bekommen die Einladung.",
      "Steht bei der Person `Konto aktiv, kein Portalzugriff`, heißt der Knopf `Zugriff gewähren`.",
      "Bei einer eingeschränkten `Portalrolle` wie `Notfallkontakt` oder `Nur Abholung` fragt moto zuerst `Vollen Zugriff gewähren?`. Erst `Zugriff gewähren` erteilt den Zugang.",
      "Unter `Elternzugänge` steht `Einladungen gehen ohne Freigabe raus`? Dann laden Eltern direkt ein. Über `Zu den Einstellungen` änderst du das.",
      "Dort steht `Eltern können derzeit niemanden einladen`? Dann darfst nur du einladen.",
    ],
    troubleshootingDetails: [
      "Jemand mit Konto bekommt keine Nachricht? Die Person darf das Kind im Elternportal nicht sehen, zum Beispiel mit `Portalrolle` `Nur Abholung`. Oder das Kind hat heute keine Betreuung gebucht. Oder die Nachricht für dieses Kind wurde schon verschickt.",
      "Ein Elternteil sagt, die Nachricht ist nicht angekommen? moto schickt sie kein zweites Mal. Bitte die Person, im Spam-Ordner nachzusehen. Sonst sag ihr selbst: Die Betreuung steht im Elternportal beim Kind unter `Betreuung & Wochenplan`.",
      "`Einladen` bewirkt nichts? Dann fehlt die `E-Mail`. Trage sie über `Bearbeiten` nach.",
      "Bei der Person steht `Link gilt nicht mehr`? Zum Beispiel wurde die `E-Mail` nach der Einladung geändert. Wähle `Einladung neu senden`. Der neue Link geht an die Adresse, die jetzt eingetragen ist.",
      "Bei der Person steht `Adresse prüfen` oder `Verzögert`, und `Erneut einladen` fehlt? Der Hinweis dort sagt, was zu tun ist. Mehr dazu unter `Wenn eine E-Mail nicht ankommt`.",
      "Die Person ist schon bei einem anderen Kind eingetragen? Wähle `Vorhandene/n suchen` statt `+ Hinzufügen`. Sonst entstehen zwei Einträge für dieselbe Person.",
      "Fehlt `Elternzugänge` in der Seitenleiste? Der Bereich ist der Leitung vorbehalten.",
      "Eine Anfrage passt nicht? Wähle `Ablehnen` und bestätige mit `Ablehnen`. Es wird kein Zugang gewährt.",
    ],
    related: [
      HELP_TOPICS.leadEmailDelivery,
      HELP_TOPICS.leadManageStudent,
      HELP_TOPICS.leadParentVisibility,
      HELP_TOPICS.parentMessage,
    ],
  };
}
