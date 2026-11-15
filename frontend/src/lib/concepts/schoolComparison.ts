import { ChartBarHorizontalIcon } from "@phosphor-icons/react/ssr";
import { defineMotoConcept } from "./define";

// Liegende Balken: die Schulen eines Trägers nebeneinander, der längste
// Balken vorn (#4715). Petrol wie die Schule; die stehenden Balken der
// Auslastung zeigen dagegen einen Verlauf über die Zeit.
export const schoolComparisonConcept = defineMotoConcept(
  "schoolComparison",
  "Standortvergleich",
  ChartBarHorizontalIcon,
  "petrol",
  "function",
  "administration",
);
