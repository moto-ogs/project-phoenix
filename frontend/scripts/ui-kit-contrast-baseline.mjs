import baseline from "./ui-kit-contrast-baseline.json" with { type: "json" };

// Kontrast-Ratsche gegen gray-400 (#7108, scripts/oxlint-plugin-ui-kit.mjs):
// ui-kit/no-gray-400-text und ui-kit/no-gray-400-focus-ring. Funde je Datei;
// die Zahl darf nur sinken. Nach einem Abbau `pnpm run
// ui-kit:contrast-baseline`, das Skript weigert sich, sie anzuheben.
/** @type {Record<string, Record<string, number>>} */
export const contrastRatchetBaseline = baseline;
