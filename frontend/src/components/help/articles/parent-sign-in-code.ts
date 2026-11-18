import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/settings?tab=signIn` (#7051). Die Anmeldung mit Code ist
 * freiwillig und gilt für das ganze Konto. Ein verlorenes Postfach setzt das
 * moto-Team über eine Schule des Kontos zurück; ein Konto ohne Schule kann
 * sie deshalb nicht einschalten.
 */
export function parentSignInCodeTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentSignInCode,
    title: "Anmeldung mit Code",
    question: "Wie schütze ich mein Konto mit einem Code?",
    summary:
      "Nach dem Passwort gibst du einen Code aus deiner E-Mail ein. Das ist freiwillig.",
    group: "einstieg",
    audience: "parent",
    icon: "ShieldCheck",
    steps: [
      "Tippe unten auf `Mehr` und dann auf `Einstellungen`.",
      "Wähle den Bereich `Anmeldung`.",
      "Wähle bei `Anmeldung mit Code` den Knopf `Einschalten`.",
      "moto schickt dir einen Code per E-Mail. Trage ihn bei `Code aus der E-Mail` ein.",
      "Wähle `Einschalten`.",
    ],
    result:
      "Bei jeder Anmeldung fragt moto jetzt nach dem Passwort auch nach einem Code aus deiner E-Mail.",
    notes: [
      "Nach dem Code fragt moto: `Soll moto dieses Gerät merken?` Auf deinem eigenen Gerät wählst du `Ja, merken und anmelden`. Dann fragt moto dort eine Zeit lang nicht nach dem Code.",
      "Auf Geräten, die mehrere Personen nutzen, wählst du `Nein, nur anmelden`.",
      "Gemerkte Geräte siehst und entfernst du unter `Einstellungen` im Bereich `Anmeldung`.",
      "Die Anmeldung mit Code gilt für dein ganzes moto-Konto. Arbeitest du auch an einer Schule mit moto, fragt moto dort ebenfalls nach dem Code.",
    ],
    differences: [
      "Am Computer steht `Einstellungen` in der Navigation statt hinter `Mehr`.",
      "Statt `Einschalten` steht dort ein Hinweis? Dann gehört dein Konto noch zu keiner Schule. Sobald dein Kind an einer Schule angemeldet ist, kannst du die Anmeldung mit Code einschalten.",
      "Zum Ausschalten wählst du `Ausschalten` und gibst dein Passwort ein.",
    ],
    troubleshootingDetails: [
      "Kein Code angekommen? Sieh im Spam-Ordner nach. Oder wähle `Neuen Code anfordern`.",
      "Kein Zugriff mehr auf dein E-Mail-Postfach? Wende dich an deine Schule. Das moto-Team setzt die Anmeldung mit Code dann zurück. Danach reicht wieder dein Passwort.",
    ],
    related: [HELP_TOPICS.parentLogin, HELP_TOPICS.parentAccount],
  };
}
