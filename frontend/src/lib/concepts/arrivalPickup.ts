import { ArrowsLeftRightIcon } from "@phosphor-icons/react/ssr";
import { defineMotoConcept } from "./define";

/**
 * Wann Kinder ankommen und gehen (#4714): die Auswertung des Trägers, nicht
 * die Abholung eines einzelnen Kindes (`pickup`). Die Pfeile stehen für
 * Kommen und Gehen; mit eigenem Ton unterscheidet sich das Konzept von der
 * Vertretung, die dieselben Pfeile trägt.
 */
export const arrivalPickupConcept = defineMotoConcept(
  "arrivalPickup",
  "Ankunft und Abholung",
  ArrowsLeftRightIcon,
  "greenDeep",
  "function",
  "presence",
);
