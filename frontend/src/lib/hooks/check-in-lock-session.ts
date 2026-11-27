"use client";

import { onSWRScopeReset } from "~/lib/swr";

import { clearCheckInLock } from "./check-in-lock";

// Die Sperre „Einstempeln erst ab …“ gehört zur Sitzung, die sie bekam:
// Abmelden oder ein anderes Konto räumt sie mit dem SWR-Cache ab. Die
// Shell der Mitarbeitenden lädt dieses Modul einmal.
onSWRScopeReset(clearCheckInLock);
