import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { SIMPLE_NAV_DIFFERENCE } from "../help-article-shared";

export function findStaffTopic(presenceMode: HelpPresenceMode): HelpTopic {
  return {
    id: HELP_TOPICS.findStaff,
    title: "Eine Person aus dem Team finden",
    question: "Wie finde ich eine Person aus dem Team?",
    summary: "Suche eine Person und sieh, ob sie gerade da ist.",
    group: "team",
    audience: ["caregiver", "lead"],
    icon: "UserRoundSearch",
    steps: [
      "Klappe in der Seitenleiste `Team` auf und öffne `Mitarbeitende`.",
      "Gib den Namen in das Suchfeld ein.",
      // Live geprueft: die Auswahl traegt ihren aktuellen Wert als
      // Beschriftung, anfangs `Alle`. Ein Knopf `Filter` existiert nicht.
      "Öffne bei Bedarf rechts neben der Suche die Auswahl `Alle`.",
      "Wähle zum Beispiel `Anwesend`, `Unterwegs` oder `Krank/Urlaub`.",
      "Prüfe auf der Karte, ob die Person gerade da ist.",
    ],
    // Ohne Aufsichten steht auf der Karte auch keine.
    result:
      presenceMode === "binary"
        ? "Du siehst, ob die Person gerade arbeitet."
        : "Du siehst, ob die Person gerade arbeitet. Manchmal steht dort auch ihre Aufsicht.",
    differences: [
      "Auch ohne Recht für Personalakten siehst du, wo die Person gerade ist. Die Karte öffnet dann keine Personalakte. Frage bei Bedarf deine Leitung.",
      "Möchtest du der Person schreiben? Öffne den `Team-Chat`.",
      "Unter `Ehemalige` kannst du frühere Beschäftigungen nur lesen. Die Personalakte zeigt den Zeitraum, Stammdaten und frühere Arbeitszeiten. Welche Angaben du siehst, hängt von deinen Rechten ab.",
      "Personaldokumente wurden beim Austritt endgültig gelöscht. Sie stehen auch in der früheren Personalakte nicht mehr bereit.",
      "Mit `Zurück zu den Mitarbeitenden` kommst du wieder zur Auswahl `Ehemalige`. Eine Wiederaufnahme erfolgt beim Einladen.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    notes: [
      "Hat jemand früher bei dir gearbeitet? Wähle in der Auswahl `Ehemalige`. Die Karte zeigt den Zeitraum in moto. Öffne die Karte für die früheren Angaben.",
    ],
    image: "/help/screens/personal-ehemalige.webp",
    imageAlt:
      "Frühere Beschäftigung mit Zeitraum. Die Angaben sind nur lesbar.",
    related: [HELP_TOPICS.teamChat, HELP_TOPICS.activeSupervision],
  };
}
