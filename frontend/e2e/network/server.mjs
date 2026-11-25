import { createServer } from "node:http";
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createAppWorkspace } from "./app-workspace.mjs";
import { catalogReads, profile } from "./catalog-fixtures.mjs";
import { networkPorts } from "./ports.mjs";
import { realClock } from "../real-clock.mjs";

const sharedTenantCookie = process.env.TENANT_SWITCH_EVIDENCE === "1";
const ports = networkPorts(sharedTenantCookie ? "tenantSwitch" : "network");
const frontendPort = ports.frontend;
const apiPort = ports.api;
let switchRequests = 0;
let logoutRequests = 0;
const schools = ["school-a", "school-b"].map((subdomain, index) => ({
  tenant_id: String(index + 1),
  slug: subdomain,
  subdomain,
  name: index === 0 ? "School A" : "School B",
  organization_id: "1",
  organization_name: "Fixture",
}));

// Only synthetic fixtures. This is not a backend/authentication test.
const envelope = (data) => ({ status: "success", data });
function claims(scope = "") {
  const issuedAt = Math.floor(
    realClock("der Next-Server prüft exp gegen seine Wanduhr") / 1000,
  );
  return {
    id: 1,
    sub: "1",
    scope,
    tenant_id: scope === "parent" ? undefined : 1,
    org_id: 1,
    first_name: "Test",
    last_name: "Fixture",
    email: "fixture@example.invalid",
    roles: [
      scope === "school" ? "lehrkraft" : scope === "parent" ? "guardian" : "user",
    ],
    role_is_system: null,
    permissions: [],
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
}
// Shared-cookie mode models the server-side session family (#5194): login
// opens a family, logout revokes it, and session routes refuse a token whose
// family is gone although it has not expired.
let familySequence = 0;
const liveFamilies = new Set();
const fixtureToken = (payload) =>
  `fixture.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.fixture`;
const tokenClaims = (token) => {
  try {
    return JSON.parse(
      Buffer.from(String(token).split(".")[1] ?? "", "base64url").toString(),
    );
  } catch {
    return null;
  }
};
const bearerClaims = (req) =>
  tokenClaims((req.headers.authorization ?? "").replace(/^Bearer /, ""));
const familyRevoked = (req) => {
  const family = bearerClaims(req)?.family_id;
  return (
    sharedTenantCookie && family !== undefined && !liveFamilies.has(family)
  );
};
// Every session route of every portal refuses a revoked family; the auth
// routes answer for themselves.
const familyRoutes = (path) =>
  !path.startsWith("/auth/") &&
  !path.startsWith("/operator/auth/") &&
  !path.startsWith("/__fixture/") &&
  path !== "/health";
// One protected read per other portal, through its BFF (the operator's
// through the catalog proxy, #2352).
const portalReads = new Set(["/operator/organizations"]);
const refuse = (res, { status, code, detail = "The session is not valid" }) => {
  res.writeHead(status, { "Content-Type": "application/problem+json" });
  res.end(
    JSON.stringify({ type: "about:blank", title: "Unauthorized", status, code, detail }),
  );
};
const api = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${apiPort}`);
  const path = url.pathname;
  let data;
  if (familyRoutes(path) && familyRevoked(req)) {
    refuse(res, {
      status: 401,
      detail: "session has been revoked",
      code: "general.permission",
    });
    return;
  }
  if (path === "/health") data = {};
  else if (path === "/auth/tenant/resolve") {
    const slug = url.searchParams.get("slug") ?? "proof-off";
    data = envelope({
      tenant_id: sharedTenantCookie && slug === "school-b" ? "2" : "1",
      slug,
      subdomain: slug,
      name: sharedTenantCookie
        ? slug === "school-b"
          ? "School B"
          : "School A"
        : "Netzwerktest",
      organization_id: "1",
      organization_name: "Fixture",
      hidden: false,
      settings: {},
      presence_mode: "detailed",
      booked_modules: null,
      parent_messaging_enabled: false,
      parent_message_card_badge_enabled: false,
      staff_messaging_enabled: false,
      display_enabled: false,
      caldav_enabled: false,
      grade_level_max: 4,
      care_offerings_enabled: true,
      attendance_web_enabled: false,
      attendance_log_enabled: false,
      group_mode: "fixed_groups",
      operational_overview_scope: "own",
      attendance_edit_scope: "own",
      parent_request_reason_policy: "both",
      show_timetable_counts: true,
      analytics_enabled: slug === "proof-on",
      analytics_freigabe: false,
      analytics_recording_sample_percent: 0,
      student_photos_enabled: true,
      timetable_enabled: false,
      meal_plan_enabled: false,
      meal_registration_enabled: false,
      waitlist_enabled: true,
      early_checkout_note_enabled: false,
      early_checkout_note_tolerance_minutes: 0,
      weekend_follows_friday: false,
      children_without_care_place: false,
      child_search_only_navigation: false,
      simple_staff_navigation: false,
      care_facility_term: "OGS",
    });
  } else if (sharedTenantCookie && portalReads.has(path)) {
    data = envelope([]);
  } else if (sharedTenantCookie && path === "/school/notifications/feed") {
    // Through the catalog proxy: the cursor names the query that arrived.
    data = envelope({
      entries: [
        {
          id: "7",
          type: "test",
          title: "Hinweis",
          body: "Text",
          deep_link: "/school",
          created_at: "2026-11-01T08:00:00Z",
          updated_at: "2026-11-01T08:00:00Z",
          read_at: null,
        },
      ],
      next_cursor: url.search,
      unread_count: 1,
    });
  } else if (
    sharedTenantCookie &&
    req.method === "PUT" &&
    path === "/school/notifications/preferences/absence"
  ) {
    // Like the backend: a recorded decision answers 204.
    res.writeHead(204);
    res.end();
    return;
  } else if (sharedTenantCookie && catalogReads.has(path)) {
    data = envelope(catalogReads.get(path));
  } else if (sharedTenantCookie && path === "/parent/me/enrollable-schools") {
    // Reached through the guardians' catalog proxy, not a route file.
    data = envelope([
      {
        school_id: "9007199254740993",
        school_name: "Fixture-Schule",
        school_slug: "school-a",
        school_subdomain: "school-a",
        phase_id: "12",
        phase_name: "Schuljahr",
        phase_kind: "school_year",
        service_start_date: "2026-08-01",
        service_end_date: "2027-07-31",
        already_linked: false,
        audience: "open",
        internal_note: "not in the contract",
      },
    ]);
  } else if (sharedTenantCookie && path === "/operator/auth/logout") {
    logoutRequests++;
    liveFamilies.delete(bearerClaims(req)?.family_id);
    res.writeHead(204);
    res.end();
    return;
  } else if (sharedTenantCookie && path === "/operator/auth/refresh") {
    const presented = bearerClaims(req);
    if (!liveFamilies.has(presented?.family_id)) {
      refuse(res, { status: 401, code: "general.permission" });
      return;
    }
    const token = fixtureToken({
      ...claims("platform"),
      family_id: presented.family_id,
    });
    data = envelope({ access_token: token, refresh_token: token });
  } else if (sharedTenantCookie && path === "/__fixture/switch-state") {
    data = { switchRequests, logoutRequests, liveFamilies: liveFamilies.size };
  } else if (sharedTenantCookie && path === "/auth/switch-tenant") {
    switchRequests++;
    refuse(res, {
      status: 401,
      code: "identity.mfa_session_required",
      detail: "The target school requires a second factor",
    });
    return;
  } else if (sharedTenantCookie && path === "/auth/logout") {
    // Like the backend: 204 only after the family is revoked.
    logoutRequests++;
    liveFamilies.delete(bearerClaims(req)?.family_id);
    res.writeHead(204);
    res.end();
    return;
  } else if (sharedTenantCookie && path === "/auth/refresh") {
    const presented = bearerClaims(req);
    if (!liveFamilies.has(presented?.family_id)) {
      refuse(res, { status: 401, code: "general.permission" });
      return;
    }
    const token = fixtureToken({
      ...claims(presented.scope ?? ""),
      family_id: presented.family_id,
    });
    data = { access_token: token, refresh_token: token };
  } else if (
    [
      "/auth/login",
      "/school/auth/login",
      "/parent/auth/login",
      "/operator/auth/login",
      "/caterer/auth/login",
    ].includes(path)
  ) {
    const scope = path.startsWith("/school")
      ? "school"
      : path.startsWith("/parent")
        ? "parent"
        : path.startsWith("/operator")
          ? "platform"
          : path.startsWith("/caterer")
            ? "caterer"
            : "";
    const family = sharedTenantCookie
      ? `family-${++familySequence}`
      : undefined;
    if (family) liveFamilies.add(family);
    const token = fixtureToken({ ...claims(scope), family_id: family });
    const login = {
      status: "authenticated",
      access_token: token,
      refresh_token: token,
    };
    data = ["parent", "platform", "caterer"].includes(scope)
      ? envelope(login)
      : login;
  } else if (path === "/auth/session/validate") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const {
      portal,
      access_token: access,
      refresh_token: refresh,
    } = JSON.parse(body);
    const family = tokenClaims(access)?.family_id;
    // Like Identity & Access (#5399): without the refresh token the access
    // token's family is read, and a revoked family is refused.
    if (
      sharedTenantCookie &&
      !refresh &&
      family !== undefined &&
      !liveFamilies.has(family)
    ) {
      refuse(res, {
        status: 401,
        detail: "invalid token format",
        code: "general.permission",
      });
      return;
    }
    const session = claims(portal === "tenant" ? "" : portal);
    data = {
      ...session,
      id: String(session.id),
      tenant_id:
        session.tenant_id === undefined ? undefined : String(session.tenant_id),
      org_id: String(session.org_id),
      family_id: family,
    };
  } else if (path === "/api/me/profile") data = envelope(profile);
  else if (path === "/api/me/navigation")
    data = envelope({
      current_staff: null,
      school_switches: {
        parent_news_enabled: false,
        parent_invite_mode: "direct",
        timetable_day_start_time: "08:00",
        timetable_day_end_time: "16:00",
      },
    });
  else if (path === "/api/active/supervision-context")
    data = envelope({
      groups: {
        status: "ok",
        navigation: [],
        own_group_ids: [],
        own_room_names: [],
      },
      sessions: {
        status: "ok",
        overview_status: "forbidden",
        own_status: "ok",
        items: [],
      },
      released_rooms: { status: "ok", items: [] },
    });
  // The school picker of the main domain (#7563).
  else if (path === "/auth/tenants")
    data = envelope(
      schools.map(({ slug, name, subdomain, organization_name }) => ({
        slug,
        name,
        subdomain,
        organization_name,
      })),
    );
  else if (path === "/auth/account/tenants")
    data = envelope(sharedTenantCookie ? schools : []);
  else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ status: "error", code: "fixture.not_configured" }),
    );
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
});

const fail = (message) => {
  process.stderr.write(`Network evidence: ${message}\n`);
  process.exit(1);
};
// macOS lets a wildcard and a loopback listener share a port, so a bind
// alone does not prove that loopback traffic reaches this run. Any answer on
// either loopback address means another process owns the port: stop instead
// of testing against it, and never touch that process.
const answers = (port, host) =>
  new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
for (const [service, port, name] of [
  ["fixture API", apiPort, ports.names.api],
  ["frontend", frontendPort, ports.names.frontend],
]) {
  for (const host of ["127.0.0.1", "::1"]) {
    if (await answers(port, host)) {
      fail(
        `${service} port ${port} is already in use on ${host}. Stop your own earlier run or choose another port with ${name}.`,
      );
    }
  }
}
await new Promise((resolve) => {
  api.once("error", (error) =>
    fail(
      `fixture API cannot listen on 127.0.0.1:${apiPort} (${error.code ?? "error"}). Choose another port with ${ports.names.api}.`,
    ),
  );
  api.listen(apiPort, "127.0.0.1", resolve);
});

// Do not inherit user-specific service configuration or credentials. Explicit
// empty values also take precedence over Next's automatic .env.local loading.
const frontendDirectory = fileURLToPath(new URL("../../", import.meta.url));
const workspace = createAppWorkspace(frontendDirectory);
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  API_URL: `http://127.0.0.1:${apiPort}`,
  NEXTAUTH_URL: `http://localhost:${frontendPort}`,
  NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
  AUTH_JWT_EXPIRY: "15m",
  AUTH_JWT_REFRESH_EXPIRY: "12h",
  TENANT_DOMAIN: sharedTenantCookie ? "mfa.localhost" : "localhost",
  METRICS_BEARER_TOKEN: randomBytes(32).toString("hex"),
  NEXT_PUBLIC_APP_ENV: "development",
  NEXT_PUBLIC_TENANT_DOMAIN: sharedTenantCookie ? "mfa.localhost" : "localhost",
  NEXT_PUBLIC_OPERATOR_HOSTNAME: `operator.localhost:${frontendPort}`,
  NEXT_PUBLIC_PARENTS_HOSTNAME: `eltern.localhost:${frontendPort}`,
  NEXT_PUBLIC_SCHOOL_HOSTNAME: `${sharedTenantCookie ? "schule.mfa.localhost" : "schule.localhost"}:${frontendPort}`,
  NEXT_PUBLIC_CATERER_HOSTNAME: `caterer.localhost:${frontendPort}`,
  NEXT_PUBLIC_TRAEGER_HOSTNAME: `traeger.localhost:${frontendPort}`,
  NEXT_PUBLIC_POSTHOG_KEY: "network-evidence-placeholder",
  // SaaS-shaped, nonfunctional placeholder so the real SDK uses /monitoring.
  NEXT_PUBLIC_SENTRY_DSN: "https://network_evidence@o0.ingest.sentry.io/1",
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: "network-evidence",
  SENTRY_DSN: "",
  SENTRY_AUTH_TOKEN: "",
  NEXT_PUBLIC_LOG_LEVEL: "error",
  NODE_OPTIONS: `--require ${JSON.stringify(fileURLToPath(new URL("./local-only.cjs", import.meta.url)))}`,
};
const next = spawn(
  process.execPath,
  [
    join(frontendDirectory, "node_modules/next/dist/bin/next"),
    "dev",
    "--port",
    String(frontendPort),
  ],
  { cwd: workspace.directory, env, stdio: "ignore" },
);
// Only this run's own children: the Next child and the fixture listener.
let stopping = false;
const stop = () => {
  stopping = true;
  next.kill("SIGTERM");
  api.close();
  api.closeAllConnections();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("exit", () => next.kill("SIGTERM"));
// Playwright holds stdin open; it closes when the runner ends, even when the
// runner is killed without tearing the server down.
if (process.argv.includes("--stop-with-stdin")) {
  process.stdin.on("end", stop).resume();
}
next.on("error", (error) => {
  api.close();
  workspace.cleanup();
  fail(`frontend could not start (${error.message})`);
});
next.on("close", (code, signal) => {
  workspace.cleanup();
  if (!stopping && code !== 0 && signal === null) {
    process.stderr.write(
      `Network evidence: frontend on port ${frontendPort} exited with code ${code}. Check the frontend configuration or choose another port with ${ports.names.frontend}.\n`,
    );
  }
  api.close();
  api.closeAllConnections();
  // The open stdin pipe would otherwise keep this process alive.
  process.stdin.destroy();
  process.exitCode = stopping ? 0 : (code ?? 1);
});
