import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Der Caterer der Schule (ADR 0077): Einladung per E-Mail unter
 * `Speiseplan`, Ende der Belieferung, und was der Caterer sieht.
 */
export function mealCatererTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadMealCaterer,
    title: "Caterer einladen",
    question: "Wie sieht unser Caterer die Bestellungen?",
    summary:
      "Du lädst deinen Caterer per E-Mail ein. Er sieht dann die Bestellungen.",
    group: "elternarbeit",
    audience: "lead",
    icon: "Truck",
    requirements: [
      "`Anmeldung zum Mittagessen` ist eingeschaltet.",
      "Du bist Admin deiner Schule. Nur Admins laden einen Caterer ein oder beenden die Belieferung.",
    ],
    steps: [
      "Öffne in der Seitenleiste `Speiseplan`.",
      "Gehe zur Karte `Caterer`. Sie steht unter `Bestellung`.",
      "Wähle `Caterer einladen`. Ein Fenster öffnet sich.",
      "Trage `Name des Caterers` und `E-Mail-Adresse des Caterers` ein. Die Lieferadresse ist freiwillig.",
      "Wähle `Einladung senden`.",
    ],
    result:
      "Der Caterer bekommt eine E-Mail mit einem Link. Damit legt er sein Passwort fest. Danach sieht er die Bestellungen deiner Schule.",
    notes: [
      "Den Link sieht nur der Caterer. Er gilt 14 Tage.",
      "Der Caterer sieht nur Zahlen: pro Tag und, wenn du so bestellst, pro Klasse. Namen sieht er nur, wenn du unter `Einstellungen` → `Datenschutz` `Namen der Kinder für den Caterer` einschaltest.",
      "Der Caterer kann eine Bestellung nur bestätigen. Dann steht bei dir `Vom Caterer bestätigt`.",
      "Ändert sich das Essen eines Tages, an dem Kinder ein Essen gebucht haben, sieht dein Caterer einen Hinweis in seiner Glocke oben rechts. Das gilt auch für jeden neuen, geänderten oder gelöschten Schließtag. So plant er die Mengen. Die Schalter `Hinweis bei geändertem Speiseplan` und `Benachrichtigung bei Schließtagen` unter `Einstellungen` gelten auch für ihn.",
      "Beliefert der Caterer schon andere Schulen, bestätigt er mit seinem Passwort. Deine Schule kommt dann zu seinen Schulen dazu.",
      "Sein Passwort ändert der Caterer selbst. Er öffnet oben rechts sein Menü und wählt `Konto`. Hat er es vergessen, wählt er bei der Anmeldung `Passwort vergessen?`.",
      "Im `Konto` kann der Caterer auch die `Zwei-Faktor-Anmeldung` einschalten. Das ist freiwillig. Dann gibt er bei der Anmeldung zusätzlich einen Code aus seiner E-Mail ein. Statt Passwort und Code kann er auch einen Passkey nutzen.",
      "Die Belieferung beendest du auf der Karte `Caterer` über das Menü mit den drei Punkten: `Belieferung beenden`. moto fragt vorher nach. Danach sieht der Caterer deine Schule nicht mehr, und du kannst einen neuen Caterer einladen.",
      "Die Lieferliste bekommst du bei `Bestellung` über das Menü mit den drei Punkten. Wähle unter `Lieferliste der Woche` `PDF`, `Excel` oder `CSV`. Die Woche wählst du oben unter dem Titel. Es ist dieselbe Liste, die dein Caterer sieht, ohne Namen.",
    ],
    troubleshootingDetails: [
      "Kam keine E-Mail an? Unter `Offene Einladungen` steht bei der Adresse, was aus der Mail wurde, zum Beispiel `Zugestellt` oder `Nicht zustellbar`. Stimmt die Adresse nicht, widerrufst du die Einladung im Menü mit den drei Punkten mit `Widerrufen`. Sende dann eine neue.",
      "Fehlt die Karte `Caterer`? Dann ist `Anmeldung zum Mittagessen` aus, oder dein Konto darf den Speiseplan nicht bearbeiten.",
      "Steht auf der Karte nur „Einen Caterer einladen können nur Admins deiner Schule.“? Dann frag einen Admin deiner Schule nach der Einladung.",
      "Kommt dein Caterer nicht mehr an den Code für die Zwei-Faktor-Anmeldung? Dann meldet er sich beim moto-Team. Du als Schule kannst sie nicht zurücksetzen, weil ein Caterer mehrere Schulen beliefern kann.",
    ],
    related: [HELP_TOPICS.leadMealOrdering, HELP_TOPICS.leadMealPlan],
  };
}
