import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Feriengäste im Alltag (#4666): Kinder anderer Schulen in der Feriengruppe
 * der ausrichtenden OGS. Die Kindakte zeigt nur Betreuung, Notfall und
 * Abholung, die Antworten, die der Träger freigibt (#5202), und die
 * Gesundheitsangaben, wenn die Eltern zugestimmt haben (#4722). Der Hinweis
 * „Gast aus …“ nennt die Heimatschule, und Gäste stehen erst ab dem ersten
 * Tag ihrer Woche in den Listen (#5630). Vorher sagt die leere Feriengruppe,
 * wie viele Kinder dazukommen (#6680). Kinder der eigenen OGS bleiben in
 * ihrer Gruppe und zeigen die Angaben der Anmeldung in ihrer Akte (#6678).
 * Unter „Fotos“ steht der Stand der Foto-Einwilligung bei der Heimatschule
 * (#4721).
 */
export function holidayGuestsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.holidayGuests,
    title: "Feriengäste betreuen",
    question: "Wo sehe ich Notfall und Abholung eines Feriengasts?",
    summary:
      "In den Ferien kommen Kinder anderer Schulen in deine OGS. Sie stehen in der Feriengruppe.",
    group: "gruppen",
    audience: ["caregiver", "lead"],
    icon: "SunHorizon",
    image: "/help/screens/feriengast-angaben-aus-der-anmeldung.webp",
    imageAlt:
      "Notfall, Abholung, Gesundheit, Fotos und Angaben aus der Ferienanmeldung bei einem Feriengast.",
    requirements: [
      "Deine OGS richtet eine Ferienwoche für den Träger aus.",
      "Die Leitung hat unter `Ferienwochen` eine Feriengruppe gewählt.",
      "Die Ferienwoche hat begonnen. Vorher stehen Feriengäste in keiner Liste, auch nicht unter `Alle Kinder`.",
    ],
    steps: [
      "Öffne die Feriengruppe. Unter dem Namen jedes Feriengasts steht seine Schule, zum Beispiel `Gast aus Grundschule am See`.",
      "Melde Feriengäste an und ab wie jedes andere Kind.",
      "Öffne die Karte eines Feriengasts.",
      "Lies unter `Betreuung` die Woche und die gebuchte Zeit.",
      "Unter `Notfall` stehen die Eltern und weitere Kontakte. Unter `Abholung` steht, wer das Kind außer den Eltern abholen darf.",
      "Unter `Gesundheit` stehen Allergien, Medikamente und weitere Hinweise der Eltern.",
      "Unter `Fotos` steht, ob die Eltern eine Foto-Einwilligung gegeben haben. Steht dort `Keine Foto-Einwilligung`, mach bitte keine Fotos von dem Kind.",
      "Unter `Angaben aus der Ferienanmeldung` steht zum Beispiel, ob das Kind allein nach Hause gehen darf.",
    ],
    result: "Du weißt, wann das Kind gehen darf und wen du im Notfall anrufst.",
    notes: [
      "Denselben Hinweis `Gast aus …` siehst du unter `Alle Kinder`, in der Aufsicht und auf der Karte des Kindes. Steht nur `Feriengast` da, haben die Eltern keine Schule genannt.",
      "Die Gesundheitsangaben stehen auch in den `Gesundheitsinformationen` des Feriengasts. Du siehst sie also auch in der Gruppe und in der `Gesundheitsliste`.",
      "Vor der Ferienwoche ist die Feriengruppe leer. Dort steht dann, wie viele Kinder dazukommen und ab wann. Zum Beispiel `Feriengruppe: 3 Kinder kommen ab 04.01.2027 dazu.`",
      "Kinder deiner OGS sind keine Feriengäste. Sie bleiben in ihrer Gruppe. Notfall, Abholung und Zeiten aus der Anmeldung stehen in ihrer Kinderakte unter `Angaben aus der Ferienanmeldung`.",
      "Die Foto-Einwilligung geben und widerrufen die Eltern bei der Schule ihres Kindes. Ein Widerruf steht sofort bei dir unter `Fotos`. Ein Foto in moto bekommt ein Feriengast nicht.",
      "Mehr als Betreuung, Notfall, Abholung, Gesundheit, Fotos und die freigegebenen Angaben siehst du von einem Feriengast nicht. Die übrigen Angaben bleiben beim Träger.",
      "Jeder Blick auf Notfall und Abholung steht im Zugriffsprotokoll deiner OGS.",
    ],
    differences: [
      "Nach dem letzten Tag der Woche steht der Feriengast nicht mehr in der Gruppe und nicht mehr im Check-in. Seine Angaben bleiben noch 7 Tage zum Nachlesen. Die Gesundheitsangaben nicht: Sie sind nach dem letzten Tag der Woche gelöscht.",
    ],
    troubleshootingDetails: [
      "Fehlt `Angaben aus der Ferienanmeldung`? Dann gibt der Träger keine Frage frei.",
      "Fehlt `Fotos`? Dann geht das Kind auf keine Schule deines Trägers, oder die Ferienwoche ist vorbei. Frage dann die Eltern.",
      "Fehlt `Gesundheit`? Dann haben die Eltern nichts angegeben oder der Weitergabe nicht zugestimmt.",
      "Ist die Feriengruppe leer? Vor dem ersten Tag der Ferienwoche ist das richtig. Die Feriengäste kommen am ersten Tag von selbst dazu.",
      "Fehlt die Feriengruppe unter `Gruppen`? Hat sie keine eigenen Kinder, steht sie dort erst ab dem ersten Tag der Woche.",
      "Fehlt ein Feriengast? Anmeldungen bestätigt der Träger. Neu bestätigte Kinder kommen innerhalb einer Stunde in die Gruppe.",
      "Siehst du `Notfall` und `Abholung` nicht? Dafür brauchst du das Recht, die Angaben der Kinder zu lesen. Frage deine Leitung.",
    ],
    related: [HELP_TOPICS.webAttendance, HELP_TOPICS.ownGroups],
  };
}
