"use client";

import dynamic from "next/dynamic";

// Der Reiter ist nur nach Auswahl von „Plan“ sichtbar. Die kleine
// Nachlade-Grenze hält seine Kalender- und Planlogik aus der Standardansicht.
export const RoomPlanControls = dynamic(() =>
  import("./room-plan-tab").then((mod) => mod.RoomPlanControls),
);

export const RoomPlanTab = dynamic(() =>
  import("./room-plan-tab").then((mod) => mod.RoomPlanTab),
);

// Der Sperrbereich lädt seinen Dialog und den Terminabgleich erst auf dem
// Stammdaten-Reiter nach. Die Raumübersicht bleibt dadurch klein.
export const RoomClosuresSection = dynamic(() =>
  import("./room-closures-section").then((mod) => mod.RoomClosuresSection),
);
