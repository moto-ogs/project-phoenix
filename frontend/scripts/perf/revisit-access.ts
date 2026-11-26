import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { berlinTodayISO } from "../../src/lib/date-helpers";
import { PORTAL_ROUTES } from "../../src/lib/portal-paths";

import {
  loginToCachedLocalPortal,
  loginToLocalMfaPortal,
} from "../../e2e/local-tenant-login";
import { readSeedAccess, readSeedProfile } from "../seed-state";
import { dismissNotificationHint, login, perfPort } from "./access";
import { perfServerEnv } from "./env.mjs";

export type RevisitRole =
  | "admin"
  | "betreuer"
  | "parents"
  | "school"
  | "traeger"
  | "operator"
  | "caterer";

/** Only numeric output from a successful full-day simulation may enter a report. */
export function readDayEvidence(seedCreatedAt?: string) {
  const [seed, day, ...rows] = readFileSync(
    "../tmp/dev-native/revisit-day.txt",
    "utf8",
  )
    .trim()
    .split("\n");
  const today = berlinTodayISO();
  if (!seed || seed !== seedCreatedAt || day !== today)
    throw new Error(
      "Tagesbeleg passt nicht zu Seed und Messtag: scripts/perf-revisit.sh --prepare-day",
    );
  const counts = Object.fromEntries(
    rows.map((row) => {
      const match =
        /^ *(Sessions started|Attendance records|Students checked in|Early pickups|Messages written): +(\d+)$/.exec(
          row,
        );
      if (!match) throw new Error("Ungültiger Tagesbeleg");
      return [match[1]!, Number(match[2])];
    }),
  );
  if (
    Object.keys(counts).length !== 5 ||
    Object.values(counts).some((n) => n <= 0)
  )
    throw new Error("Unvollständige Vollbetriebs-Simulation");
  return { day, counts };
}

export function revisitFixture() {
  const state = readSeedProfile({ profile: "vollbetrieb" });
  const api = new URL(perfServerEnv().API_URL!);
  if (
    api.protocol !== "http:" ||
    api.hostname !== "localhost" ||
    api.origin !== state?.baseUrl
  )
    throw new Error(
      "Der native localhost-Server und der Ursprung des vollbetrieb-Seeds müssen übereinstimmen.",
    );
  const seed = state.profile;
  const students = Object.values(seed?.entities?.students ?? {});
  const families = (seed?.credentials?.parents ?? []).filter(
    (parent) =>
      parent.email &&
      parent.password &&
      parent.student_ids?.length &&
      parent.student_ids.every((id) =>
        students.some((student) => student.id === id),
      ),
  );
  const first = families.find((parent) => parent.student_ids!.length > 1);
  const second = families.find(
    (parent) =>
      !parent.student_ids!.some((id) => first?.student_ids!.includes(id)),
  );
  if (
    !seed.credentials?.caterer?.email ||
    !seed.credentials.caterer.password ||
    !seed.credentials.operator?.email ||
    !seed.credentials.operator.password
  )
    throw new Error(
      "Lokaler vollbetrieb-Seed mit bestätigten Caterer- und Operator-Zugängen erforderlich.",
    );
  const staff = seed?.credentials?.accounts?.betreuer?.[0];
  const room = Object.values(seed?.entities?.rooms ?? {}).find(
    (r) => r.name === "Mensa",
  );
  if (
    !staff?.staff_id ||
    !staff.name ||
    !room ||
    !seed?.school?.slug ||
    !seed?.school?.id ||
    !seed.school.name ||
    !seed.organization?.slug ||
    !seed.organization.name ||
    !first ||
    !second
  ) {
    throw new Error(
      "Revisit braucht vollbetrieb mit zwei Familien ohne gemeinsame Kinder.",
    );
  }
  const family = (parent: typeof first) => {
    const child = students.find(
      (student) => student.id === parent.student_ids![0],
    )!;
    return {
      email: parent.email!,
      password: parent.password!,
      childId: child.id,
      siblingId: parent.student_ids?.[1],
      guardianId: parent.guardian_id,
      childName: child.first_name + " " + child.last_name,
    };
  };
  return {
    seedCreatedAt: state.createdAt,
    seedStudents: students.length,
    schoolId: seed.school.id,
    schoolName: seed.school.name,
    schoolSlug: seed.school.slug,
    staff: { id: staff.staff_id, name: staff.name },
    room,
    students,
    orgName: seed.organization.name,
    orgSlug: seed.organization.slug,
    first: family(first),
    second: family(second),
    operator: seed.credentials?.operator,
    caterer: seed.credentials?.caterer,
  };
}

export type RevisitFixture = ReturnType<typeof revisitFixture>;

export async function openRevisitSession(
  page: Page,
  role: RevisitRole,
  fixture: RevisitFixture,
  secondParent = false,
) {
  const env = perfServerEnv();
  const tenant = role === "admin" || role === "betreuer";
  const hostname = tenant
    ? fixture.schoolSlug + ".localhost:" + perfPort()
    : env["NEXT_PUBLIC_" + role.toUpperCase() + "_HOSTNAME"];
  const origin = new URL("http://" + hostname);
  if (
    !origin.hostname.endsWith(".localhost") ||
    origin.port !== perfPort() ||
    origin.host !== hostname
  )
    throw new Error("Revisit braucht lokale Portal-Hosts mit PERF_PORT.");
  if (tenant) {
    const access = readSeedAccess({ role, profile: "vollbetrieb" });
    if (!access)
      throw new Error("Zugang für " + role + " fehlt im lokalen Seed.");
    await login(page, access);
    await dismissNotificationHint(page, origin.origin);
  } else {
    const credentials =
      role === "school" || role === "traeger"
        ? readSeedAccess({
            profile: "vollbetrieb",
            role: role === "school" ? "lehrkraft" : "school_admin",
          })
        : role === "operator"
          ? fixture.operator
          : role === "caterer"
            ? fixture.caterer
            : secondParent
              ? fixture.second
              : fixture.first;
    if (!credentials)
      throw new Error("Zugang für " + role + " fehlt im lokalen Seed.");
    if (role === "parents") {
      // The parent isolation, logout and rights probes use fresh contexts
      // and must not share a family they will revoke.
      await loginToLocalMfaPortal(page, origin.origin, credentials);
    } else {
      await loginToCachedLocalPortal(
        page,
        origin.origin,
        credentials,
        "../tmp/revisit-role-sessions",
        PORTAL_ROUTES[role].basePath,
      );
    }
  }
  if (role === "parents") {
    // A returning parent has finished the first-steps panel. Dismiss it through
    // the UI; otherwise it can cover a child link on the phone.
    const dismiss = page.getByRole("button", {
      name: "Erste Schritte ausblenden",
      exact: true,
    });
    await dismiss.waitFor({ timeout: 6000 }).catch(() => undefined);
    if (await dismiss.isVisible()) {
      await dismiss.click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /ausblenden/i })
        .click();
      await dismiss.waitFor({ state: "hidden" });
    }
  }
  return origin.origin;
}
