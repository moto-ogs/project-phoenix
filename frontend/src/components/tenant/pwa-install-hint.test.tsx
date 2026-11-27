import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaInstallHint } from "./pwa-install-hint";
import { GROUP_ROOM_SHADES } from "~/lib/location-helper";
import {
  canPromptInstall,
  createChromeIntentUrl,
  isAndroidDevice,
  isIosDevice,
  isSamsungInternet,
  recordVisit,
  resetInstallPromptForTests,
  triggerInstallPrompt,
} from "~/lib/pwa-install-prompt";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36";
const SAMSUNG_INTERNET_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36";
const ANDROID_WEBVIEW_WITHOUT_WV_UA =
  "Mozilla/5.0 (Linux; Android 8.1; Pixel 2 Build/OPM1.171019.011) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/67.0.3396.87 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function stubNavigator(
  overrides: Partial<Navigator> & { standalone?: boolean },
) {
  vi.stubGlobal("navigator", {
    userAgent: DESKTOP_UA,
    platform: "MacIntel",
    maxTouchPoints: 0,
    ...overrides,
  });
}

function stubMatchMedia(standalone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("isIosDevice", () => {
  it("detects iPhone user agents", () => {
    expect(isIosDevice({ userAgent: IPHONE_UA } as Navigator)).toBe(true);
  });

  it("detects iPadOS masquerading as MacIntel with touch", () => {
    expect(
      isIosDevice({
        userAgent: DESKTOP_UA,
        platform: "MacIntel",
        maxTouchPoints: 5,
      } as Navigator),
    ).toBe(true);
  });

  it("rejects desktop browsers", () => {
    expect(
      isIosDevice({
        userAgent: DESKTOP_UA,
        platform: "MacIntel",
        maxTouchPoints: 0,
      } as Navigator),
    ).toBe(false);
  });
});

describe("isAndroidDevice", () => {
  it("detects Android browser user agents", () => {
    expect(isAndroidDevice({ userAgent: ANDROID_UA } as Navigator)).toBe(true);
  });

  it("rejects Android WebView user agents", () => {
    expect(
      isAndroidDevice({ userAgent: ANDROID_WEBVIEW_UA } as Navigator),
    ).toBe(false);
    expect(
      isAndroidDevice({
        userAgent: ANDROID_WEBVIEW_WITHOUT_WV_UA,
      } as Navigator),
    ).toBe(false);
  });

  it("rejects iOS and desktop user agents", () => {
    expect(isAndroidDevice({ userAgent: IPHONE_UA } as Navigator)).toBe(false);
    expect(isAndroidDevice({ userAgent: DESKTOP_UA } as Navigator)).toBe(false);
  });
});

describe("isSamsungInternet", () => {
  it("detects Samsung Internet without classifying Chrome as Samsung", () => {
    expect(
      isSamsungInternet({ userAgent: SAMSUNG_INTERNET_UA } as Navigator),
    ).toBe(true);
    expect(isSamsungInternet({ userAgent: ANDROID_UA } as Navigator)).toBe(
      false,
    );
  });
});

describe("createChromeIntentUrl", () => {
  it("preserves the current page as Chrome target and browser fallback", () => {
    const pageUrl = new URL(
      "https://school-a.moto-app.de/profile?tab=push#notifications",
    );

    expect(createChromeIntentUrl(pageUrl)).toBe(
      [
        "intent://school-a.moto-app.de/profile?tab=push#notifications",
        "#Intent;scheme=https;package=com.android.chrome;",
        `S.browser_fallback_url=${encodeURIComponent(pageUrl.href)};end`,
      ].join(""),
    );
  });

  it("rejects non-web URLs", () => {
    expect(() =>
      createChromeIntentUrl(new URL("ftp://school-a.moto-app.de/profile")),
    ).toThrow("Chrome intent URLs require an HTTP or HTTPS URL.");
  });
});

/**
 * Puts storage in the state of someone opening the app for a second browser
 * session, which is the earliest point the hint is allowed to appear.
 */
function seedReturningVisitor() {
  localStorage.setItem("moto-pwa-install-hint-visits", "1");
  sessionStorage.clear();
}

type HintEnvironment = Readonly<{
  userAgent: string;
  platform?: string;
  standalone?: boolean;
  legacyStandalone?: boolean;
}>;

/** Renders the hint in one browser environment on top of the test defaults. */
function renderInEnvironment({
  standalone = false,
  legacyStandalone = false,
  ...nav
}: HintEnvironment) {
  stubNavigator({ ...nav, standalone: legacyStandalone });
  stubMatchMedia(standalone);
  return render(<PwaInstallHint />);
}

/** Fires the Chrome event the install-prompt module captures at import time. */
function dispatchInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = Object.assign(new Event("beforeinstallprompt"), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  window.dispatchEvent(event);
  return prompt;
}

describe("recordVisit", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("counts one visit per browser session, not per call", () => {
    expect(recordVisit(window)).toBe(1);
    expect(recordVisit(window)).toBe(1);
    sessionStorage.clear();
    expect(recordVisit(window)).toBe(2);
  });
});

describe("PwaInstallHint", () => {
  const SAMSUNG = {
    userAgent: SAMSUNG_INTERNET_UA,
    platform: "Linux armv81",
  };

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_TENANT_DOMAIN", "moto-app.de");
    window.location.href = "https://school-a.moto-app.de/dashboard";
    localStorage.clear();
    sessionStorage.clear();
    resetInstallPromptForTests();
    seedReturningVisitor();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetInstallPromptForTests();
  });

  it("renders the Samsung instructions in a centered floating card", () => {
    const { container } = renderInEnvironment(SAMSUNG);
    expect(screen.getByText("moto als App nutzen")).toBeInTheDocument();

    const card = container.firstElementChild;
    expect(card).toHaveClass("fixed", "rounded-2xl", "border-2");
    expect(card).toHaveStyle({
      borderColor: GROUP_ROOM_SHADES.base,
      backgroundColor: GROUP_ROOM_SHADES.bgHover,
    });
    expect(card?.className).not.toMatch(/moto-content-surface/);
    expect(card).toHaveClass("left-1/2", "-translate-x-1/2", "max-w-md");
    expect(card?.className).not.toMatch(/\binset-x-/);
    expect(card?.className).not.toMatch(/\bsm:right-/);
  });

  it("clears responsive bottom controls only while they are visible", () => {
    const { container } = renderInEnvironment(SAMSUNG);
    const card = container.firstElementChild;

    expect(card).toHaveClass(
      "bottom-[calc(5.75rem+var(--moto-floating-fab-offset,0rem)+var(--moto-checkin-bar-offset,0rem)+env(safe-area-inset-bottom))]",
      "lg:bottom-8",
    );
    expect(card?.className).not.toMatch(/\bxl:bottom-/);
    expect(card?.className).not.toMatch(/10\.5rem/);
  });

  it("appears on the second visit", () => {
    localStorage.clear();
    sessionStorage.clear();
    const first = renderInEnvironment(SAMSUNG);
    expect(screen.queryByText("moto als App nutzen")).not.toBeInTheDocument();
    first.unmount();

    sessionStorage.clear(); // a new browser session
    renderInEnvironment(SAMSUNG);
    expect(screen.getByText("moto als App nutzen")).toBeInTheDocument();
  });

  it.each<[string, HintEnvironment]>([
    ["iOS Safari", { ...SAMSUNG, userAgent: IPHONE_UA, platform: "iPhone" }],
    ["Android Chrome", { ...SAMSUNG, userAgent: ANDROID_UA }],
    ["Android WebView", { ...SAMSUNG, userAgent: ANDROID_WEBVIEW_UA }],
    [
      "desktop Chrome",
      { ...SAMSUNG, userAgent: DESKTOP_UA, platform: "MacIntel" },
    ],
    ["standalone mode", { ...SAMSUNG, standalone: true }],
    ["the legacy standalone flag", { ...SAMSUNG, legacyStandalone: true }],
  ])("stays hidden in %s", (_name, hidden) => {
    const { unmount } = renderInEnvironment(hidden);
    expect(screen.queryByText("moto als App nutzen")).not.toBeInTheDocument();
    unmount();

    seedReturningVisitor();
    renderInEnvironment(SAMSUNG);
    // Anker: Der sonst gleiche Samsung-Browser zeigt den Hinweis.
    expect(screen.getByText("moto als App nutzen")).toBeInTheDocument();
  });

  it("routes Samsung Internet users to Chrome instead of offering Samsung installation", () => {
    stubNavigator({
      userAgent: SAMSUNG_INTERNET_UA,
      platform: "Linux armv81",
    });
    stubMatchMedia(false);
    dispatchInstallPrompt();

    render(<PwaInstallHint />);

    expect(screen.getByText(/nicht über Samsung Internet/)).toBeInTheDocument();
    const chromeLink = screen.getByRole("link", { name: "In Chrome öffnen" });
    expect(chromeLink).toHaveAttribute(
      "href",
      expect.stringContaining("package=com.android.chrome"),
    );
    expect(screen.getByText(/school-a\.moto-app\.de/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "App installieren" }),
    ).not.toBeInTheDocument();
    expect(canPromptInstall()).toBe(false);
  });

  it("captures the one-tap install prompt on the protected parents host", () => {
    vi.stubEnv("NEXT_PUBLIC_PARENTS_HOSTNAME", "parents.moto-app.de");
    window.location.href = "https://parents.moto-app.de/settings";
    stubNavigator({ userAgent: ANDROID_UA, platform: "Linux armv81" });
    stubMatchMedia(false);

    dispatchInstallPrompt();

    expect(canPromptInstall()).toBe(true);
  });

  it.each(["accepted", "dismissed"] as const)(
    "replays a captured %s prompt once for the current setup flow",
    async (outcome) => {
      stubNavigator({ userAgent: ANDROID_UA, platform: "Linux armv81" });
      const prompt = dispatchInstallPrompt(outcome);

      await expect(triggerInstallPrompt()).resolves.toBe(outcome);
      await expect(triggerInstallPrompt()).resolves.toBe("unavailable");
      expect(prompt).toHaveBeenCalledTimes(1);
    },
  );

  it("hides and persistently dismisses the card after browser-menu installation", async () => {
    renderInEnvironment(SAMSUNG);

    // Anker: der Hinweis steht da, bevor die Installation gemeldet wird.
    expect(screen.getByText("moto als App nutzen")).toBeInTheDocument();
    fireEvent(window, new Event("appinstalled"));

    await waitFor(() => {
      expect(screen.queryByText("moto als App nutzen")).not.toBeInTheDocument();
    });
    expect(localStorage.getItem("moto-pwa-install-hint-dismissed")).toBe("1");
  });

  it("stays hidden after dismissal", () => {
    const { unmount } = renderInEnvironment(SAMSUNG);
    // Anker: der Hinweis steht da, bevor er geschlossen wird.
    fireEvent.click(screen.getByLabelText("Hinweis schließen"));
    expect(screen.queryByText("moto als App nutzen")).not.toBeInTheDocument();
    unmount();

    render(<PwaInstallHint />);
    expect(screen.queryByText("moto als App nutzen")).not.toBeInTheDocument();
  });
});
