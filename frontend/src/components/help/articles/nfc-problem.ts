import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { unavailableNfcTopic, unknownNfcTopic } from "../help-article-shared";

export function nfcProblemTopic(nfcEnabled: boolean | null): HelpTopic {
  if (nfcEnabled === null) {
    return unknownNfcTopic(
      HELP_TOPICS.nfcProblem,
      "Das NFC-Tablet funktioniert nicht",
      "Was kann ich tun, wenn das NFC-Tablet nicht funktioniert?",
      "TabletSmartphone",
      [HELP_TOPICS.webAttendance, HELP_TOPICS.trackWorkTime],
      "probleme",
    );
  }
  if (!nfcEnabled) {
    return unavailableNfcTopic(
      HELP_TOPICS.nfcProblem,
      "Das NFC-Tablet funktioniert nicht",
      "Was kann ich tun, wenn das NFC-Tablet nicht funktioniert?",
      "TabletSmartphone",
      [HELP_TOPICS.webAttendance, HELP_TOPICS.trackWorkTime],
      "probleme",
    );
  }

  return {
    id: HELP_TOPICS.nfcProblem,
    title: "Das NFC-Tablet funktioniert nicht",
    question: "Was kann ich tun, wenn das NFC-Tablet nicht funktioniert?",
    summary: "Prüfe Strom, Verbindung, Lesegerät und Armband nacheinander.",
    group: "probleme",
    audience: ["caregiver", "lead"],
    icon: "TabletSmartphone",
    steps: [
      "Prüfe, ob Tablet und NFC-Sensor Strom haben.",
      "Prüfe, ob das Tablet mit dem Internet verbunden ist.",
      "Lege das Armband flach und für einen kurzen Moment auf den NFC-Sensor.",
      "Teste ein zweites, sicher funktionierendes Armband.",
      "Melde dich mit der Geräte-PIN an und öffne `Armband identifizieren`.",
      "Prüfe dort, ob das Armband erkannt und der richtigen Person zugewiesen ist.",
      "Starte das Tablet neu, wenn weiterhin kein Armband erkannt wird.",
      "Hilft nichts davon? Gib die Fehlermeldung an deine Leitung oder an das moto-Team weiter.",
    ],
    result:
      "Der Vergleich grenzt die Ursache ein. Das Problem liegt am Armband oder am Tablet.",
    differences: [
      "Wird nur ein Armband nicht erkannt, prüfe oder erneuere dessen Zuweisung.",
      "Werden keine Armbänder erkannt, prüfe besonders NFC-Sensor, Kabel und Gerätestatus.",
      "Bei einem Ausfall können berechtigte Personen Anwesenheit und Arbeitszeit vorübergehend in der moto-App erfassen.",
    ],
    related: [HELP_TOPICS.tagAssignment, HELP_TOPICS.nfcCheckIn],
  };
}
