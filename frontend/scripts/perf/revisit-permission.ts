import { devices, type Browser, type Page } from "@playwright/test";
import type { GuardianWithRelationship } from "../../src/lib/contract/guardians.generated";
import { gotoTolerant } from "./access";
import {
  CPU_THROTTLE,
  NETWORK,
  QUIET,
  REPEATS,
  requestCost,
} from "./navigation-probe";
import { installContentProbe } from "./revisit-content";
import { RequestRecorder } from "./recorder";
import { openRevisitSession, type RevisitFixture } from "./revisit-access";

/** Change only a seeded preset through the same versioned command as the staff form. */
async function saveRole(
  admin: Page,
  path: string,
  role: string,
  version: string,
) {
  return admin.evaluate(
    async ({ path, role, version }) => {
      const response = await fetch(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guardian: {},
          relationship: { guardian_role: role },
          expected_version: version,
        }),
      });
      if (!response.ok)
        throw new Error(
          "Fixture-Rolle nicht gespeichert: HTTP " + response.status,
        );
      const { data } = (await response.json()) as {
        data: GuardianWithRelationship;
      };
      if (data.guardian_role !== role || !data.version)
        throw new Error("Fixture-Rolle nicht bestätigt.");
      return data.version;
    },
    { path, role, version },
  );
}

/** A real permission change, not a stale-data test: measure the family's ordinary
 * home after one child's portal permission is removed. The other child stays available.
 * No request to open the no-longer-authorized child's record is made. */
export async function measurePermissionChange(
  browser: Browser,
  fixture: RevisitFixture,
  admitTrial: () => Promise<number>,
) {
  const staffContext = await browser.newContext();
  const parentContext = await browser.newContext();
  try {
    const admin = await staffContext.newPage();
    await openRevisitSession(admin, "admin", fixture);
    const parent = await parentContext.newPage();
    const origin = await openRevisitSession(parent, "parents", fixture);
    const { childId, siblingId, guardianId } = fixture.first;
    if (!siblingId || !guardianId)
      throw new Error(
        "Rechtefixture braucht zwei Geschwister mit demselben Elternkonto.",
      );
    const current = 'main a[href="/children/' + childId + '"]';
    const sibling = 'main a[href="/children/' + siblingId + '"]';
    await parent.locator(current).first().waitFor();
    await parent.locator(sibling).first().waitFor();
    const session = await parentContext.storageState();
    const list = "/api/guardians/students/" + childId + "/guardians";
    const readRole = () =>
      admin.evaluate(
        async ({ list, guardianId }) => {
          const response = await fetch(list);
          if (!response.ok)
            throw new Error(
              "Seed-Beziehung nicht lesbar: HTTP " + response.status,
            );
          const { data } = (await response.json()) as {
            data: GuardianWithRelationship[];
          };
          const link = data.find(
            (row) => row.guardian?.id === String(guardianId),
          );
          if (!link) throw new Error("Beziehung der Seed-Familie fehlt.");
          return { role: link.guardian_role, version: link.version };
        },
        { list, guardianId },
      );
    const path = list + "/" + guardianId;
    const original = await readRole();
    if (
      !["primary_guardian", "legal_guardian", "co_guardian"].includes(
        original.role,
      )
    )
      throw new Error("Kein vollständiges Rollen-Preset der Seed-Familie.");
    let changedVersion: string | undefined;
    async function restoreRole() {
      // A PUT can commit even if its reply is lost. Read back before undoing;
      // never overwrite a later version changed by another editor.
      const latest = await readRole();
      if (latest.role !== original.role) {
        if (
          latest.role !== "pickup_only" ||
          (changedVersion && latest.version !== changedVersion)
        )
          throw new Error(
            "Seed-Beziehung wurde zwischenzeitlich geändert; keine fremde Änderung überschrieben.",
          );
        await saveRole(admin, path, original.role, latest.version);
      }
    }
    try {
      changedVersion = await saveRole(
        admin,
        path,
        "pickup_only",
        original.version,
      );
      const results = [];
      for (let repeat = 1; repeat <= REPEATS; repeat++) {
        for (const mobile of [false, true]) {
          const startIdlePercent = await admitTrial();
          const profile = mobile ? "Pixel 7" : "Desktop";
          const context = await browser.newContext({
            ...devices[mobile ? "Pixel 7" : "Desktop Chrome"],
            storageState: session,
            locale: "de-DE",
            timezoneId: "Europe/Berlin",
            serviceWorkers: "block",
          });
          try {
            const page = await context.newPage();
            await installContentProbe(page);
            const cdp = await context.newCDPSession(page);
            await cdp.send("Emulation.setCPUThrottlingRate", {
              rate: CPU_THROTTLE,
            });
            await cdp.send("Network.emulateNetworkConditions", {
              offline: false,
              ...NETWORK,
              downloadThroughput: mobile
                ? (1.6 * 1024 * 1024) / 8
                : NETWORK.downloadThroughput,
            });
            const recorder = new RequestRecorder(page);
            recorder.start();
            await gotoTolerant(page, origin + "/");
            // Navigation time origin is the actual start of this deliberately fresh document.
            const ms = await page.evaluate(
              ({ sibling, current }) =>
                new Promise<number>((resolve, reject) => {
                  let matchedLastFrame = false;
                  const frame = () => {
                    const matched =
                      window.__revisit.matches({
                        path: "/",
                        criterion: "Weiterhin zugängliches Geschwisterkind",
                        markers: [{ css: sibling }],
                      }) && !document.querySelector(current);
                    if (matched && matchedLastFrame) {
                      resolve(Math.round(performance.now()));
                      return;
                    }
                    matchedLastFrame = matched;
                    if (performance.now() > 30000) {
                      reject(new Error("Verbleibendes Kind nicht bestätigt."));
                      return;
                    }
                    requestAnimationFrame(frame);
                  };
                  requestAnimationFrame(frame);
                }),
              { sibling, current },
            );
            const settle = await recorder.waitForQuiet(QUIET);
            const requests = recorder.records.filter((r) => !r.noise);
            results.push({
              profile,
              repeat,
              startIdlePercent,
              ms,
              settle,
              ...requestCost(requests),
              documents: requests.filter((r) => r.resourceType === "document")
                .length,
            });
            session.cookies = await context.cookies();
          } finally {
            await context.close();
          }
        }
      }
      return results;
    } finally {
      await restoreRole();
      await parent.reload({ waitUntil: "domcontentloaded" });
      await parent.locator(current).first().waitFor();
    }
  } finally {
    await parentContext.close();
    await staffContext.close();
  }
}
