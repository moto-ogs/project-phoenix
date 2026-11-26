#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const slug = "failover-school";
const tenantHost = `${slug}.localhost`;
const operatorHost = "operator.localhost";
const photoKey = "operations.student_photos_enabled";
const accessLifetime = 330;
const token = (encoding = "hex") => randomBytes(32).toString(encoding);
const password = () => `${token()}Aa9!`;
const round = (ms) => Math.round(ms);

// Do not inherit Compose selectors, dotenv credentials, or a remote Docker host.
const cliEnv = Object.fromEntries(
  ["PATH", "HOME", "USER", "LANG", "XDG_RUNTIME_DIR"].map((key) => [key, process.env[key]]),
);

function command(program, args, { env = cliEnv, cwd = root, logs = false, allowFailure = false, label = `${program} ${args[0]}`, diagnostic } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      if (logs) process.stdout.write(chunk);
      else stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      if (logs) process.stderr.write(chunk);
      else stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) resolve({ code, stdout: stdout.trim(), stderr });
      // Arguments/output may carry throwaway secrets (for example the seeder's).
      else reject(new Error(`${label} exited ${code}${diagnostic ? `: ${diagnostic(stderr)}` : ""}`));
    });
  });
}

const docker = (args, options) => command("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
  label: `docker ${args[0]}`, ...options,
});

async function environment() {
  const example = await readFile(join(root, ".env.example"), "utf8");
  const defaults = Object.fromEntries(
    [...example.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(([, key, value]) => [key, value]),
  );
  const databasePassword = token();
  return {
    ...defaults,
    APP_ENV: "development",
    NEXT_PUBLIC_APP_ENV: "development",
    API_URL: "http://server:8080",
    AUTH_JWT_EXPIRY: `${accessLifetime}s`,
    AUTH_JWT_SECRET: token(),
    NEXTAUTH_SECRET: token(),
    POSTGRES_PASSWORD: databasePassword,
    DB_DSN: `postgres://postgres:${databasePassword}@postgres:5432/postgres?sslmode=disable`,
    DB_MAX_OPEN_CONNS: "25",
    DB_MAX_IDLE_CONNS: "10",
    PHOENIX_AUTH_PASSWORD: password(),
    PHOENIX_DEMO_PASSWORD: password(),
    ADMIN_EMAIL: "bootstrap@example.test",
    ADMIN_PASSWORD: password(),
    OPERATOR_EMAIL: "operator@example.test",
    OPERATOR_PASSWORD: password(),
    HEALTH_DATA_KEYS: `probe:${token("base64")}`,
    BANK_DATA_KEYS: `probe:${token("base64")}`,
    METRICS_BEARER_TOKEN: token(),
    TURNSTILE_SECRET_KEY: token(),
    POSTHOG_HOST: "",
    NEXT_PUBLIC_OPERATOR_HOSTNAME: operatorHost,
    NEXT_PUBLIC_PARENTS_HOSTNAME: "parents.localhost",
    NEXT_PUBLIC_SCHOOL_HOSTNAME: "school.localhost",
    NEXT_PUBLIC_CATERER_HOSTNAME: "caterer.localhost",
    NEXT_PUBLIC_TRAEGER_HOSTNAME: "traeger.localhost",
  };
}

const publish = (target) => [{ target, host_ip: "127.0.0.1", protocol: "tcp" }];

class Stack {
  constructor(work, env) {
    this.work = work;
    this.env = env;
    this.name = `failover8073-${randomBytes(6).toString("hex")}`;
    this.file = join(work, "compose.json");
    this.images = Object.fromEntries(["server", "frontend"].map((role) => [role, `${this.name}-${role}`]));
  }

  compose(...args) {
    return docker(["compose", "-f", this.file, "--env-file", "/dev/null", "-p", this.name, ...args], {
      label: `docker compose ${args[0]} (${this.name})`,
      diagnostic: args[0] === "up" ? (stderr) => {
        for (const value of Object.values(this.env)) {
          if (value.length >= 4) stderr = stderr.replaceAll(value, "[redacted]");
        }
        return stderr.trim().split("\n").slice(-3).join("\n");
      } : undefined,
    });
  }

  async configure() {
    const result = await docker([
      "compose", "--env-file", "/dev/null", "-p", this.name, "--profile", "*",
      "-f", "environments/staging.compose.yml", "config", "--format", "json",
    ], { env: { ...cliEnv, ...this.env }, allowFailure: true });
    if (result.code !== 0) {
      const missing = result.stderr.match(/required variable ([A-Z0-9_]+)/)?.[1];
      throw new Error(`Could not resolve staging Compose${missing ? `: missing ${missing}` : ""}`);
    }
    this.config = JSON.parse(result.stdout);
    // The shared host can exhaust Docker's automatic address pools. Use a
    // throwaway /24 from the benchmarking range; Docker still rejects overlaps.
    this.config.networks.staging.ipam = {
      config: [{ subnet: `198.${randomInt(18, 20)}.${randomInt(256)}.0/24` }],
    };
    for (const [name, volume] of Object.entries(this.config.volumes)) {
      volume.name = `${this.name}_${name}`;
      assert(!volume.external, "The probe must own every volume");
    }
    const { services } = this.config;
    for (const service of Object.values(services)) {
      delete service.logging;
      delete service.ports;
      service.restart = "no";
    }
    for (const name of ["server", "worker", "migrate", "bank-data-rekey", "upload-seal"]) {
      services[name].image = this.images.server;
    }
    services.frontend.image = this.images.frontend;
    services.frontend.ports = publish(3000);
    services.server.ports = publish(8080);
    services.mailpit = {
      image: "axllent/mailpit:v1.30", networks: { staging: null }, ports: publish(8025),
    };
    const caddyFile = join(this.work, "Caddyfile");
    const deployed = await readFile(join(root, "deploy/caddy/Caddyfile"), "utf8");
    const pool = deployed.match(/^\(replica_pool\) \{\n[\s\S]+?^\}/m)?.[0];
    assert(pool, "Caddy replica_pool snippet missing");
    const proxy = (role, port, health) => `:${port} {
  reverse_proxy ${this.name}-${role}-1:${port} ${this.name}-${role}-2:${port} {
    import replica_pool ${health}
    header_down X-Probe-Replica {http.reverse_proxy.upstream.hostport}
  }
}`;
    await writeFile(caddyFile, `{\n  auto_https off\n}\n${pool}\n${proxy("server", 8080, "/health")}\n${proxy("frontend", 3000, "/api/health")}\n`);
    services.caddy = {
      image: "caddy:2.11.9-alpine",
      networks: { staging: null },
      ports: [...publish(3000), ...publish(8080)],
      volumes: [{ type: "bind", source: caddyFile, target: "/etc/caddy/Caddyfile", read_only: true }],
      tmpfs: ["/data", "/config"],
    };
    await this.save();
  }

  async save() {
    // Compose interpolates a second time when it reads the resolved model.
    // Keep required values (including passwords) literal and owner-readable.
    const json = JSON.stringify(this.config, null, 2).replaceAll("$", () => "$$");
    await writeFile(this.file, json, { mode: 0o600 });
    this.saved = true;
  }

  async build(revision) {
    const build = (role, args) => docker([
      "build", "--build-arg", `SENTRY_RELEASE=${revision}`, "-t", this.images[role], ...args,
    ], { logs: true });
    const frontendArgs = ["API_URL", "TENANT_DOMAIN", ...Object.keys(this.env).filter(
      (key) => key === "NEXT_PUBLIC_APP_ENV" || key === "NEXT_PUBLIC_TENANT_DOMAIN" || key.endsWith("_HOSTNAME"),
    )].flatMap((key) => ["--build-arg", `${key}=${this.env[key]}`]);
    const results = await Promise.allSettled([
      build("frontend", ["-f", "frontend/Dockerfile.prod", ...frontendArgs, "frontend"]),
      build("server", ["--target", "production", "backend"]),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }

  async replicas(service) {
    const { stdout } = await this.compose("ps", "--format", "json", service);
    const rows = stdout.startsWith("[") ? JSON.parse(stdout) : stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return rows.sort((a, b) => a.Name.localeCompare(b.Name));
  }

  async port(service, target) {
    const { stdout } = await this.compose("port", service, String(target));
    assert.match(stdout, /^127\.0\.0\.1:\d+$/);
    return Number(stdout.split(":")[1]);
  }

  async sql(query) {
    const { stdout } = await this.compose("exec", "-T", "postgres", "psql", "-XAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", query);
    return stdout;
  }

  checkReplicas() {
    return command("bash", [join(root, "scripts/release-backup.sh"), "check-replicas"], {
      cwd: this.work,
      env: { ...cliEnv, DOCKER_HOST: "unix:///var/run/docker.sock", COMPOSE_FILE: this.file, COMPOSE_PROJECT_NAME: this.name },
      allowFailure: true,
    });
  }

  async clean() {
    const results = [];
    if (this.saved) {
      results.push(await this.compose("--profile", "*", "down", "--volumes", "--remove-orphans").catch((error) => error));
    }
    for (const image of Object.values(this.images)) {
      const found = await docker(["image", "ls", "-q", image]);
      if (found.stdout) results.push(await docker(["image", "rm", image]).catch((error) => error));
    }
    const error = results.find((result) => result instanceof Error);
    if (error) throw error;
    for (const args of [["ps", "-aq"], ["volume", "ls", "-q"], ["network", "ls", "-q"]]) {
      const { stdout } = await docker([...args, "--filter", `label=com.docker.compose.project=${this.name}`]);
      assert(!stdout, `Leftover ${args[0]} resources in ${this.name}`);
    }
    console.log(`Removed ${this.name}: containers, volumes, network and built images`);
  }
}

function openResponse(port, path, { host = "localhost", method = "GET", body, headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1", port, path, method, signal,
      headers: { Host: `${host}:${port}`, ...headers },
    }, resolve);
    req.on("error", reject);
    req.end(body);
  });
}

async function http(port, path, options = {}) {
  const response = await openResponse(port, path, { signal: AbortSignal.timeout(10_000), ...options });
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return { status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") };
}

function json({ text }) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Expected a JSON response");
  }
}

function expectStatus(response, status, operation) {
  if (response.status === status) return response;
  // Report only a typed problem code, not any body data, tokens or headers.
  const code = response.text.match(/"code"\s*:\s*"([a-z_]+\.[a-z_]+)"/)?.[1];
  throw new Error(`${operation}: HTTP ${response.status}, expected ${status}${code ? ` (${code})` : ""}`);
}

function write(port, path, host, method, value, headers = {}) {
  return http(port, path, {
    host, method, body: JSON.stringify(value),
    headers: { Origin: `http://${host}:${port}`, "Content-Type": "application/json", ...headers },
  });
}

function cookies(response, previous = "") {
  const jar = new Map(previous.split("; ").filter(Boolean).map((pair) => [pair.split("=", 1)[0], pair]));
  for (const line of response.headers["set-cookie"] ?? []) {
    const [pair] = line.split(";", 1);
    const [name, value] = pair.split("=", 2);
    if (value && !/\bMax-Age=0\b/i.test(line)) jar.set(name, pair);
    else jar.delete(name);
  }
  return [...jar.values()].join("; ");
}

async function until(check, description, timeout = 10_000, interval = 100) {
  const deadline = performance.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(interval);
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

async function mailCode(port, email, after) {
  return until(async () => {
    const result = json(await http(port, "/api/v1/messages"));
    const message = result.messages.find((mail) =>
      mail.Subject === "Dein moto-Anmeldecode" && Date.parse(mail.Created) >= after &&
      mail.To.some((recipient) => recipient.Address === email));
    if (!message) return;
    const detail = json(await http(port, `/api/v1/message/${message.ID}`));
    return detail.Text.match(/\b\d{6}\b/)?.[0];
  }, "the isolated Mailpit's sign-in code", 45_000, 200);
}

async function signIn(port, mail, { prefix, host, credentials, bff = true }) {
  const after = Date.now() - 1000;
  let response = expectStatus(await write(port, `${prefix}/login`, host, "POST", credentials), 200, `${prefix}/login`);
  const login = json(response);
  const data = login.data ?? login;
  if (data.status === "mfa_required") {
    const code = await mailCode(mail, credentials.email, after);
    response = expectStatus(await write(port, `${prefix}/mfa/verify`, host, "POST", {
      challenge_token: data.challenge_token, code,
    }), 200, `${prefix}/mfa/verify`);
  } else if (data.status === "mfa_enrollment_required") {
    const proof = bearerHeaders(data.access_token);
    const started = await write(port, `${prefix}/mfa/enroll/start`, host, "POST", {}, proof);
    assert(started.status === 200 || started.status === 204, `${prefix}/mfa/enroll/start: HTTP ${started.status}`);
    const code = await mailCode(mail, credentials.email, after);
    const challenge = started.text ? json(started).challenge_token : undefined;
    response = expectStatus(await write(port, `${prefix}/mfa/enroll/confirm`, host, "POST", {
      code, challenge_token: challenge,
    }, proof), 200, `${prefix}/mfa/enroll/confirm`);
  }
  if (bff) {
    const cookie = cookies(response);
    assert(/session-token(?:\.\d+)?=/.test(cookie), `${prefix} did not install a session`);
    return cookie;
  }
  const reply = json(response);
  const bearer = (reply.data ?? reply).access_token;
  assert(bearer, `${prefix} did not mint an access token`);
  const claims = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url"));
  return { bearer, claims };
}

async function setup(stack) {
  console.log("Starting isolated PostgreSQL and Mailpit; applying migrations");
  await stack.compose("up", "-d", "--wait", "--wait-timeout", "90", "postgres", "mailpit");
  await stack.compose("run", "--rm", "--no-deps", "migrate");
  await stack.compose("up", "-d", "--wait", "--wait-timeout", "90", "--scale", "frontend=2", "server", "worker", "frontend", "caddy");
  return {
    api: await stack.port("caddy", 8080),
    bff: await stack.port("caddy", 3000),
    mail: await stack.port("mailpit", 8025),
  };
}

const bearerHeaders = (bearer) => ({ Authorization: `Bearer ${bearer}` });
const browserHeaders = (cookie, account) => ({ Cookie: cookie, "X-Moto-Session-Account": account });
const replicaOf = (headers) => headers["x-probe-replica"]?.split(":", 1)[0];
const dataOf = (response) => json(response).data;

async function seedSchool(stack, { bff, mail }) {
  console.log(`Seeding one school and one staff account in ${stack.name} via the operator portal`);
  const operatorCookie = await signIn(bff, mail, {
    prefix: "/api/operator/auth", host: operatorHost,
    credentials: { email: stack.env.OPERATOR_EMAIL, password: stack.env.OPERATOR_PASSWORD },
  });
  const headers = { Cookie: operatorCookie };
  const create = async (path, body) => dataOf(expectStatus(
    await write(bff, path, operatorHost, "POST", body, headers), 201, `POST ${path}`));
  const organization = await create("/api/operator/organizations", { name: "Failover Probe", slug: "failover-probe" });
  const school = await create("/api/operator/schools", {
    organization_id: organization.id, name: "Failover School Original", slug, subdomain: slug, federal_state: "DE-NW",
    email: "probe-school@example.test",
  });
  const roles = dataOf(expectStatus(await http(bff, "/api/operator/roles", { host: operatorHost, headers }), 200, "operator roles"));
  const admin = roles.find((role) => role.name === "admin");
  assert(admin, "School admin role missing");
  const staff = { email: "probe-admin@example.test", password: password(), tenant_slug: slug };
  await create(`/api/operator/schools/${school.id}/create-account`, {
    email: staff.email, password: staff.password, confirm_password: staff.password,
    first_name: "Failover", last_name: "Probe", role_id: admin.id,
  });
  return { staff, school, operatorCookie };
}

function sessionIsValid(session, account, tenant) {
  return !session?.error && !session?.notBooked && session?.user?.id === account &&
    session.user.tenantId === tenant && Date.parse(session.expires) > Date.now();
}

function sessionRead(port, cookie, account) {
  return http(port, "/api/auth/session", { host: tenantHost, headers: browserHeaders(cookie, account) });
}

async function readLoad(name, read, valid, stop) {
  const counts = { statuses: {}, invalid: 0, replicas: {} };
  while (!stop.aborted) {
    try {
      const response = await read();
      counts.statuses[response.status] = (counts.statuses[response.status] ?? 0) + 1;
      const replica = replicaOf(response.headers) ?? "no-upstream";
      counts.replicas[replica] = (counts.replicas[replica] ?? 0) + 1;
      if (response.status !== 200 || !valid(response)) counts.invalid++;
    } catch {
      counts.statuses.transport = (counts.statuses.transport ?? 0) + 1;
      counts.invalid++;
    }
    if (!stop.aborted) await delay(25);
  }
  return { name, ...counts };
}

function stream(port, options, signal) {
  const connections = [];
  const failures = [];
  const run = async () => {
    while (!signal.aborted) {
      let connection;
      try {
        const response = await openResponse(port, "/api/sse/events", { ...options, signal });
        const replica = replicaOf(response.headers);
        if (response.statusCode !== 200 || !response.headers["content-type"]?.startsWith("text/event-stream")) {
          response.resume();
          failures.push({ replica, status: response.statusCode });
        } else {
          response.setEncoding("utf8");
          let pending = "";
          for await (const chunk of response) {
            pending += chunk;
            const frames = pending.split(/\r?\n\r?\n/);
            pending = frames.pop();
            for (const frame of frames) {
              const event = frame.match(/^event: (.+)$/m)?.[1];
              const data = frame.match(/^data: (.+)$/m)?.[1];
              if (!event || !data) continue;
              const payload = JSON.parse(data);
              if (event === "connected" && payload.status === "ready") {
                connection = { replica, opened: performance.now(), settings: [] };
                connections.push(connection);
              } else if (connection && event === "tenant_settings_changed") {
                connection.settings.push({ source: payload.data?.source, at: performance.now() });
              }
            }
          }
          if (connection) connection.eof = response.complete;
        }
      } catch (error) {
        if (!signal.aborted) failures.push({ error: error.code ?? error.name });
      } finally {
        if (connection) connection.ended = performance.now();
      }
      if (!signal.aborted) await delay(1000);
    }
  };
  return { connections, failures, done: run() };
}

async function awaitConnection(peer, description, after = 0, exclude) {
  return until(() => peer.connections.find((connection) =>
    connection.opened > after && connection.replica !== exclude && !connection.ended), description, 20_000, 15);
}

async function settingsEvent(bff, headers, peers, value) {
  const start = performance.now();
  const response = await write(bff, `/api/settings/values/${photoKey}`, tenantHost, "PUT", { value }, headers);
  expectStatus(response, 200, "student photo setting");
  return Promise.all(peers.map(async (peer) => {
    const event = await until(() => peer.connections.at(-1)?.settings.find(
      (item) => item.at >= start && item.source === photoKey), "tenant_settings_changed", 5_000, 10);
    return round(event.at - start);
  }));
}

// The PUT is idempotent. Count committed row changes, not just final state.
async function prepareWriteAudit(stack) {
  await stack.sql(`CREATE TABLE public.failover_onboarding_writes (account_id bigint not null);
    CREATE FUNCTION public.failover_count_onboarding() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
    BEGIN
      INSERT INTO public.failover_onboarding_writes VALUES (NEW.account_id);
      RETURN NEW;
    END $$;
    CREATE TRIGGER failover_count_onboarding AFTER INSERT OR UPDATE ON config.staff_onboardings
    FOR EACH ROW EXECUTE FUNCTION public.failover_count_onboarding();`);
}

async function writesDuringStop(stack, bff, headers, account, stage, start, dismissed) {
  const name = `Failover ${stage}`;
  const issuedAt = Date.now();
  const issued = round(performance.now() - start);
  const [post, put] = await Promise.all([
    write(bff, "/api/rooms", tenantHost, "POST", { name }, headers),
    write(bff, "/api/staff-onboarding/dismissal?outcome=completed", tenantHost, "PUT", { dismissed }, headers),
  ]);
  console.log(JSON.stringify({ stage, writesIssuedMs: issued, post: post.status, put: put.status }));
  expectStatus(post, 201, "catalog POST room");
  expectStatus(put, 200, "catalog PUT onboarding dismissal");
  assert.equal(dataOf(post)?.name, name, "Incorrect room returned");
  assert(dataOf(put)?.changed && dataOf(put)?.dismissed === dismissed, "Dismissal did not change as requested");
  const rooms = await stack.sql(`SELECT count(*) FROM facilities.rooms WHERE name = '${name}'`);
  assert.equal(rooms, "1", "POST must insert precisely one room");
  const audit = await stack.sql(`SELECT count(*) FROM public.failover_onboarding_writes WHERE account_id = ${account}`);
  assert.equal(audit, dismissed ? "1" : "2", "PUT must apply precisely once per stop");
  return issuedAt;
}

async function stopReplica(stack, role, name, peers, writes) {
  const replica = (await stack.replicas(role)).find((row) => row.Name === name);
  assert(replica, `No running ${role} replica for the stream`);
  const before = peers.map(({ connections }) => connections.at(-1));
  const started = performance.now();
  const stop = docker(["stop", replica.ID]).then(() => performance.now());
  // EOF proves the replica has received SIGTERM. Do not retry writes.
  const duringDrain = async () => {
    await until(() => before[0].ended, `${role} drain to end the old stream`, 20_000, 5);
    return writes(started);
  };
  const results = await Promise.allSettled([stop, duringDrain()]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  const [stopped, sent] = results;
  const { stdout: state } = await docker(["inspect", "-f", "{{.State.ExitCode}} {{.State.FinishedAt}}", replica.ID]);
  const [exit, finished] = state.split(" ");
  // Next.js deliberately uses 128 + SIGTERM after its shutdown completes.
  assert(exit === "0" || (role === "frontend" && exit === "143"), `${role} exited with code ${exit}`);
  assert(sent.value <= Date.parse(finished), `${role} exited before the writes could be sent during drain`);
  const reconnected = await Promise.all(peers.map(async (peer, index) => {
    const old = before[index];
    assert(old.ended && old.eof, `${role} stop did not produce clean EOF`);
    const next = await awaitConnection(peer, `${role} SSE reconnect`, old.ended, role === "server" && index === 0 ? name : role === "frontend" ? name : undefined);
    return { eofMs: round(old.ended - started), reconnectMs: round(next.opened - old.ended) };
  }));
  console.log(JSON.stringify({ stopped: role, exit: Number(exit), drainMs: round(stopped.value - started), streams: reconnected }));
  return replica;
}

async function frontendPorts(stack) {
  const replicas = await until(async () => {
    const rows = await stack.replicas("frontend");
    return rows.length === 2 && rows.every((row) => row.Health === "healthy") ? rows : null;
  }, "two healthy frontend replicas", 40_000, 500);
  return replicas.map(({ Publishers }) => {
    const port = Publishers?.find(({ TargetPort }) => TargetPort === 3000)?.PublishedPort;
    assert(Number.isInteger(port), "Missing frontend's direct loopback port");
    return port;
  });
}

async function renderedLookup(port) {
  // /api/auth/tenant/resolve is the uncached JSON proxy. The tenant layout
  // embeds the actual process-local cached lookup in its server component props.
  const response = expectStatus(await http(port, "/login", { host: tenantHost }), 200, "rendering the tenant login");
  const text = response.text.replaceAll('\\"', '"');
  const name = text.match(/"slug":"failover-school","name":"([^"]+)"/)?.[1];
  const photos = text.match(/"studentPhotosEnabled":(true|false)/)?.[1];
  assert(name && photos, "Login response does not contain the cached tenant projection");
  return { name, photos: photos === "true" };
}

async function cacheChange(ports, label, field, value, mutate) {
  const before = await Promise.all(ports.map(renderedLookup));
  assert(before[0][field] === before[1][field] && before[0][field] !== value, `${label}: did not warm both caches with the previous value`);
  const writeStarted = performance.now();
  await mutate(ports[0]);
  const acknowledged = performance.now();
  let lastStaleMs = null;
  const [writer, other] = await Promise.all([
    renderedLookup(ports[0]).then((lookup) => ({ lookup, ms: round(performance.now() - acknowledged) })),
    until(async () => {
      const sent = performance.now();
      const lookup = await renderedLookup(ports[1]);
      if (lookup[field] === value) return round(performance.now() - acknowledged);
      // Use request start for the lower bound: time spent rendering a response
      // after the lookup is not time spent serving stale cache entries.
      lastStaleMs = round(sent - acknowledged);
      assert(lookup[field] === before[1][field], `${label}: unexpected cached value`);
      assert(lastStaleMs <= 60_000, `${label}: lookup remained stale after the 60 s TTL`);
      return null;
    }, `fresh ${label} lookup on the other replica`, 62_000, 150),
  ]);
  assert.equal(writer.lookup[field], value, `${label}: writer did not invalidate its cache on success`);
  console.log(JSON.stringify({ cache: label, writeMs: round(acknowledged - writeStarted), writerFreshMs: writer.ms, otherLastStaleMs: lastStaleMs, otherFirstFreshMs: other }));
}

async function measureCache(ports, { school, operatorCookie, headers }) {
  await cacheChange(ports, "school rename", "name", "Failover School Renamed", async (port) => {
    const response = await write(port, `/api/operator/schools/${school.id}`, operatorHost, "PUT", {
      ...school, name: "Failover School Renamed", expected_version: school.version,
    }, { Cookie: operatorCookie });
    expectStatus(response, 200, "operator school rename");
  });
  await cacheChange(ports, "student photos setting", "photos", true, async (port) => {
    const response = await write(port, `/api/settings/values/${photoKey}`, tenantHost, "PUT", { value: true }, headers);
    expectStatus(response, 200, "student photo setting");
  });
}

async function prepareRotation(stack, { bff, mail, staff, account }) {
  const before = await stack.sql(`SELECT coalesce(max(id), 0) FROM auth.tokens WHERE account_id = ${account}`);
  assert(/^\d+$/.test(before), "Invalid refresh row identifier");
  const cookie = await signIn(bff, mail, { prefix: "/api/auth", host: tenantHost, credentials: staff });
  const row = await stack.sql(`SELECT family_id, extract(epoch FROM created_at)::bigint
    FROM auth.tokens WHERE account_id = ${account} AND id > ${before} AND generation = 0`);
  const [family, created] = row.split("|");
  assert(/^[0-9a-f-]{36}$/.test(family) && /^\d+$/.test(created), "Could not identify the fresh session's refresh family");
  return { cookie, family, expiredAt: (Number(created) + accessLifetime + 2) * 1000 };
}

async function measureRotation(stack, ports, { account, tenant, api, bearer, directMe }, { cookie, family, expiredAt }) {
  console.log("Waiting for the original access token to expire before concurrent session reads");
  await delay(Math.max(0, expiredAt - Date.now()));
  expectStatus(await http(api, directMe, { headers: bearerHeaders(bearer) }), 401, "expired direct access token");
  const state = () => stack.sql(`SELECT string_agg(generation::text, ',' ORDER BY generation), count(*) FILTER (WHERE rotated_at IS NULL)
    FROM auth.tokens WHERE account_id = ${account} AND family_id = '${family}'`);
  assert.equal(await state(), "0|1", "Session rotated before the two pinned requests");
  const start = performance.now();
  const first = await Promise.all(ports.map((port) => sessionRead(port, cookie, account)));
  const renewalMs = round(performance.now() - start);
  const renewed = first.map((response) => {
    expectStatus(response, 200, "renewing the BFF session");
    assert(sessionIsValid(json(response), account, tenant), "Login state lost during rotation");
    const replacement = cookies(response, cookie);
    assert(replacement && replacement !== cookie, "Rotation did not persist a replacement cookie");
    return replacement;
  });
  const crossChecks = await Promise.all(ports.map((port, index) => sessionRead(port, renewed[1 - index], account)));
  for (const response of crossChecks) {
    expectStatus(response, 200, "checking the other replica's renewed session");
    assert(sessionIsValid(json(response), account, tenant), "Expired session on cross-replica read");
  }
  assert.equal(await state(), "0,1|1", "Expected one refresh rotation with one live successor");
  console.log(JSON.stringify({ refresh: { renewalMs, initialStatuses: first.map(({ status }) => status), crossStatuses: crossChecks.map(({ status }) => status), generations: [0, 1], live: 1 } }));
}

async function negativeCheck(stack) {
  const original = stack.config.services.frontend.environment.NEXTAUTH_SECRET;
  stack.config.services.frontend.environment.NEXTAUTH_SECRET = token();
  await stack.save();
  try {
    await stack.compose("up", "-d", "--no-deps", "--no-recreate", "--scale", "frontend=3", "frontend");
    assert.equal((await stack.replicas("frontend")).length, 3, "Inconsistent frontend did not start");
    const mismatch = await stack.checkReplicas();
    assert(mismatch.code === 1 && mismatch.stderr.includes("frontend replicas differ in image or environment"), "Replica check did not detect the altered secret");
  } finally {
    stack.config.services.frontend.environment.NEXTAUTH_SECRET = original;
    await stack.save();
    await stack.compose("up", "-d", "--no-deps", "--no-recreate", "--scale", "frontend=2", "frontend");
  }
  assert.equal((await stack.checkReplicas()).code, 0, "Replica check did not recover after removal");
  console.log(JSON.stringify({ checkReplicas: { initial: 0, wrongNextAuthSecret: 1, restored: 0 } }));
}

async function waitForPool(port, path, name) {
  await until(async () => {
    const response = await http(port, path);
    return response.status === 200 && replicaOf(response.headers) === name;
  }, `Caddy to admit ${name} on ${path}`, 20_000, 50);
}

async function failover(stack, { api, bff, headers, bearer, account, tenant, directMe, staff }) {
  const stopStreams = new AbortController();
  const direct = stream(api, { headers: bearerHeaders(bearer) }, stopStreams.signal);
  const proxied = stream(bff, { host: tenantHost, headers }, stopStreams.signal);
  try {
    const [first] = await Promise.all([awaitConnection(direct, "initial API SSE"), awaitConnection(proxied, "initial BFF SSE")]);
    // At this point there is only one API: both streams necessarily use it.
    await stack.compose("up", "-d", "--wait", "--wait-timeout", "90", "--no-recreate", "--scale", "server=2", "server");
    const apiNames = (await stack.replicas("server")).map(({ Name }) => Name);
    const bffNames = (await stack.replicas("frontend")).map(({ Name }) => Name);
    assert(apiNames.length === 2 && bffNames.length === 2, "Expected two API and two BFF replicas before the stop");
    await waitForPool(api, "/health", apiNames.find((name) => name !== first.replica));
    const consistent = await stack.checkReplicas();
    assert.equal(consistent.code, 0, "Baseline replica check failed");
    console.log(JSON.stringify({ initialStreams: [direct.connections.length, proxied.connections.length], directMe }));
    await prepareWriteAudit(stack);
    const stopLoad = new AbortController();
    const readSession = async () => {
      const response = await sessionRead(bff, headers.Cookie, account);
      headers.Cookie = cookies(response, headers.Cookie);
      return response;
    };
    const readers = [
      ...[1, 2].map(() => readLoad("API", () => http(api, directMe, { headers: bearerHeaders(bearer) }),
        (response) => dataOf(response)?.email === staff.email, stopLoad.signal)),
      ...[1, 2].map(() => readLoad("BFF", readSession,
        (response) => sessionIsValid(json(response), account, tenant), stopLoad.signal)),
    ];
    let results;
    try {
      await delay(500);
      const server = await stopReplica(stack, "server", first.replica, [direct, proxied],
        (start) => writesDuringStop(stack, bff, headers, account, "API", start, true));
      console.log(JSON.stringify({ afterApiStopEventMs: await settingsEvent(bff, headers, [direct, proxied], true) }));
      await docker(["start", server.ID]);
      await waitForPool(api, "/health", server.Name);
      const bffOwner = proxied.connections.at(-1).replica;
      const directBefore = direct.connections.at(-1);
      const frontend = await stopReplica(stack, "frontend", bffOwner, [proxied],
        (start) => writesDuringStop(stack, bff, headers, account, "BFF", start, false));
      console.log(JSON.stringify({ afterBffStopEventMs: await settingsEvent(bff, headers, [direct, proxied], false) }));
      assert(direct.connections.at(-1) === directBefore && !directBefore.ended, "Next.js stop interrupted the direct API stream");
      await docker(["start", frontend.ID]);
    } finally {
      stopLoad.abort();
      results = await Promise.all(readers);
      console.log(JSON.stringify({ readers: results, streamFailures: [direct.failures, proxied.failures] }));
    }
    assert(results.every((result) => result.invalid === 0 && result.statuses[200] > 0), "A load read failed or lost its session");
  } finally {
    stopStreams.abort();
    await Promise.all([direct.done, proxied.done]);
  }
}

async function main() {
  assert.equal(process.platform, "linux", "Run the probe on a Linux Docker host");
  const { stdout: revision } = await command("git", ["rev-parse", "HEAD"]);
  console.log(`${new Date().toISOString()} ${hostname()} ${revision}`);
  const env = await environment();
  const work = await mkdtemp(join(tmpdir(), "replica-failover-"));
  const stack = new Stack(work, env);
  try {
    await stack.configure();
    await stack.build(revision);
    const ports = await setup(stack);
    const runtime = { ...ports, ...await seedSchool(stack, ports) };
    console.log("Signing in test users");
    const { bearer, claims } = await signIn(runtime.api, runtime.mail, {
      prefix: "/auth", host: "localhost", credentials: runtime.staff, bff: false,
    });
    const account = String(claims.id);
    const tenant = String(claims.tenant_id);
    assert(/^\d+$/.test(account) && /^\d+$/.test(tenant), "Invalid access claims");
    const staffCookie = await signIn(runtime.bff, runtime.mail, {
      prefix: "/api/auth", host: tenantHost, credentials: runtime.staff,
    });
    const oldMe = await http(runtime.api, "/api/me/", { headers: bearerHeaders(bearer) });
    const directMe = oldMe.status === 404 ? "/api/me/profile" : "/api/me/";
    console.log(JSON.stringify({ originalMeStatus: oldMe.status }));
    const probe = { ...runtime, bearer, account, tenant, directMe, headers: browserHeaders(staffCookie, account) };
    const renewal = await prepareRotation(stack, probe);
    await failover(stack, probe);
    const frontend = await frontendPorts(stack);
    await measureCache(frontend, probe);
    await measureRotation(stack, frontend, probe, renewal);
    await negativeCheck(stack);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    try {
      await stack.clean();
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  // Do not print assertion diffs or nested errors that might include auth data.
  console.error(error.message);
  process.exitCode = 1;
});
