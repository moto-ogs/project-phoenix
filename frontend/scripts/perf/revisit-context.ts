import { devices, type Browser } from "@playwright/test";
import { gotoTolerant } from "./access";
import { CPU_THROTTLE, NETWORK, requestCost } from "./navigation-probe";
import { RequestRecorder } from "./recorder";
import { openRevisitSession, type RevisitFixture } from "./revisit-access";
import { installContentProbe } from "./revisit-content";
import { parentStops } from "./revisit-targets";

/** Not warm reads: a logout requires confirmation, then the former account's bookmark requires a new login. */
export async function measureParentSwitch(
  browser: Browser,
  fixture: RevisitFixture,
  mobile = false,
) {
  const context = await browser.newContext({
    ...devices[mobile ? "Pixel 7" : "Desktop Chrome"],
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await installContentProbe(page);
    const origin = await openRevisitSession(page, "parents", fixture);
    const before = parentStops(fixture.first),
      after = parentStops(fixture.second);
    await page.waitForFunction(
      (c) => window.__revisit.matches(c),
      before.home.content,
    );
    // Identical route on both accounts. Even a matching link in a hidden
    // retained subtree must not allow the second account to report ready.
    const acceptedOld = await page.evaluate(
      (c) => {
        const old = document.createElement("div");
        old.hidden = true;
        const link = document.createElement("a");
        link.href = c.path;
        old.append(link);
        document.querySelector("main")!.append(old);
        try {
          return window.__revisit.matches(c.probe);
        } finally {
          old.remove();
        }
      },
      { path: after.child.content.path, probe: after.home.content },
    );
    if (acceptedOld)
      throw new Error(
        "Der Konto-Check akzeptiert den alten oder versteckten Inhalt.",
      );
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      ...NETWORK,
      downloadThroughput: mobile
        ? (1.6 * 1024 * 1024) / 8
        : NETWORK.downloadThroughput,
    });
    await page.getByRole("button", { name: /Profilmenü/ }).click();
    const recorder = new RequestRecorder(page);
    const diagnostic = () => {
      const records = recorder.records.filter((r) => !r.noise);
      return {
        ...requestCost(records),
        documents: records.filter((r) => r.resourceType === "document").length,
      };
    };
    recorder.start();
    let start = performance.now();
    await page
      .getByRole("dialog", { name: /Profilmenü/ })
      .getByRole("button", { name: "Abmelden", exact: true })
      .click();
    const confirm = page
      .getByRole("dialog")
      .getByRole("button", { name: "Abmelden", exact: true });
    await confirm.waitFor();
    const confirmation = {
      ms: Math.round(performance.now() - start),
      ...diagnostic(),
    };
    await confirm.click();
    const email = page.locator('input[type="email"]');
    await email.waitFor();
    recorder.start();
    start = performance.now();
    await gotoTolerant(page, origin + before.child.content.path);
    await email.waitFor();
    await page.locator('input[type="password"]').waitFor();
    const signedOut = {
      ms: Math.round(performance.now() - start),
      ...diagnostic(),
    };
    await openRevisitSession(page, "parents", fixture, true);
    await page.waitForFunction(
      (c) => window.__revisit.matches(c),
      after.home.content,
    );
    return {
      profile: mobile ? "Pixel 7" : "Desktop",
      confirmation,
      signedOut,
      confirmedTargetAccount: true,
    };
  } finally {
    await context.close();
  }
}
