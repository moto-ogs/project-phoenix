import { CircleHalfIcon } from "@phosphor-icons/react/ssr";
import { defineMotoConcept } from "./define";

// Der Bereich „Darstellung" der Einstellungen: wie moto für dieses Konto
// aussieht (zuerst „Mehr Kontrast").
export const displayConcept = defineMotoConcept(
  "display",
  "Darstellung",
  CircleHalfIcon,
  "neutral",
  "function",
  "system",
);
