import type { LaunchOptions } from "@playwright/test";

// #5612: Playwright 1.64 bündelt Chromium 156.0.8078.4. Das ist von
// CVE-2026-118306, -118331, -118344 und -118348 betroffen (behoben in Chrome
// 156.0.8078.73). Außerdem startet Playwright Chromium ohne Sandbox, solange
// `chromiumSandbox` nicht `true` ist. Deshalb startet jeder Lauf das
// installierte Google Chrome mit Sandbox, und `secure-chrome.setup.ts` bricht
// bei einer älteren Version ab. Übergangslösung, bis ein Playwright-Release
// einen gepatchten Browser bündelt; die Sandbox bleibt auch danach an.

/** Erste Chrome-Version, in der die CVEs aus #5612 behoben sind. */
export const MIN_CHROME_VERSION = "156.0.8078.73";

/** Startoptionen für jeden Browser, den Playwright hier öffnet. */
export function secureLaunchOptions(
  options: LaunchOptions = {},
): LaunchOptions {
  return { ...options, channel: "chrome", chromiumSandbox: true };
}

/**
 * Zeitzone und Sprache jedes Browser-Kontexts (#4027): Die Schule rechnet in
 * Berliner Zeit. Ohne `timezoneId` übernimmt Chrome die Zone des Rechners, und
 * ein Test sieht in CI (UTC) um Mitternacht einen anderen Tag als die Schule.
 * Ein Test, der eine andere Zone prüft, setzt sie mit `test.use`.
 */
const BROWSER_CONTEXT_LOCALE = {
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
} as const;

/**
 * `use`-Block für Playwright-Configs: Chrome mit Sandbox, deutsche Sprache und
 * Berliner Zeit. Ergänzt vorhandene `launchOptions`. Prüft beim Laden der
 * Config, ob ein Browser überhaupt starten kann: Playwright startet den
 * `webServer` vor dem `globalSetup`, eine spätere Prüfung käme erst nach dem
 * Serverstart.
 */
export function secureChromeUse(
  launchOptions: LaunchOptions = {},
  host: BrowserHost = currentBrowserHost(),
) {
  assertBrowserCanStart(host);
  return {
    ...BROWSER_CONTEXT_LOCALE,
    channel: "chrome",
    launchOptions: secureLaunchOptions(launchOptions),
  } as const;
}

function versionParts(version: string): number[] {
  if (!/^\d+(\.\d+){3}$/.test(version)) {
    throw new Error(`Unbekanntes Chrome-Versionsformat: "${version}"`);
  }
  return version.split(".").map(Number);
}

export function isPatchedChrome(version: string): boolean {
  const actual = versionParts(version);
  const minimum = versionParts(MIN_CHROME_VERSION);
  for (let i = 0; i < minimum.length; i++) {
    const diff = (actual[i] ?? 0) - (minimum[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

export function assertPatchedChrome(version: string): void {
  if (!isPatchedChrome(version)) {
    throw new Error(
      `Google Chrome ${version} ist älter als ${MIN_CHROME_VERSION} und hat bekannte Sicherheitslücken (#5612). ` +
        "Chrome aktualisieren (lokal: Chrome > Über Google Chrome; CI: pnpm exec playwright install --with-deps --force chrome).",
    );
  }
}

/** Umgebung, in der ein Browser starten soll. */
export interface BrowserHost {
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
}

function currentBrowserHost(): BrowserHost {
  return { env: process.env, platform: process.platform };
}

/**
 * Codex' macOS-Sandbox (Seatbelt) sperrt die Mach-Dienste, die Chrome und
 * Chromium beim Start brauchen (WindowServer, LaunchServices, coreservicesd).
 * Der Browser bricht dann sofort ab, macOS zeigt „Google Chrome wurde
 * unerwartet beendet“, und Playwright meldet nur „Target page, context or
 * browser has been closed“ (openai/codex#21292). Deshalb bricht jeder Lauf
 * vorher mit einer klaren Meldung ab. Die erlaubten Befehle in
 * `.codex/rules/browser.rules` laufen ohnehin außerhalb der Sandbox.
 */
export function assertBrowserCanStart(
  host: BrowserHost = currentBrowserHost(),
): void {
  if (host.platform === "darwin" && host.env.CODEX_SANDBOX === "seatbelt") {
    throw new Error(
      "Chrome kann in der Codex-Sandbox nicht starten: macOS sperrt dort die Dienste, die der Browser zum Start braucht. " +
        "Den Befehl ohne Umleitung oder Verkettung aufrufen (die Regeln in .codex/rules/browser.rules führen ihn dann außerhalb der Sandbox aus) oder mit erweiterten Rechten freigeben lassen.",
    );
  }
}

/** `globalSetup` path for every Playwright config in this directory. */
export const SECURE_CHROME_SETUP = "./scripts/secure-chrome.setup.ts";
