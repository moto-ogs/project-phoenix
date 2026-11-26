import type { RevisitRole } from "./revisit-access";

// Bind each role's server to a separate Linux loopback address so the public
// origin, host rewrites and build-time NEXT_PUBLIC values stay identical.
const roleHosts = {
  admin: "127.0.0.2",
  betreuer: "127.0.0.3",
  parents: "127.0.0.4",
  school: "127.0.0.5",
  traeger: "127.0.0.6",
  operator: "127.0.0.7",
  caterer: "127.0.0.8",
} satisfies Record<RevisitRole, string>;

export function revisitMode() {
  const mode = process.env.PERF_REVISIT_MODE ?? "serial";
  if (mode === "serial") return mode;
  if (mode === "parallel" && process.platform === "linux") return mode;
  throw new Error("PERF_REVISIT_MODE must be serial or parallel (Linux only).");
}

export function revisitServerHosts(): string[] {
  return revisitMode() === "parallel" ? Object.values(roleHosts) : [];
}

export function revisitRoleHost(role: RevisitRole): string | undefined {
  return revisitMode() === "parallel" ? roleHosts[role] : undefined;
}
