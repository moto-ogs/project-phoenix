import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SEED_STATE_VERSION = "3";

export interface SeedAccess {
  slug: string;
  email: string;
  password: string;
}

interface SeedProfile {
  school?: { id?: number; name?: string; slug?: string; tenant_slug?: string };
  organization?: { name?: string; slug?: string };
  entities?: {
    enrollment?: { requests?: Array<{ status_token?: string }> };
    rooms?: Record<string, { id: number; name: string }>;
    students?: Record<
      string,
      { id: number; first_name: string; last_name: string }
    >;
  };
  credentials?: {
    operator?: { email: string; password: string };
    caterer?: { email: string; password: string };
    /** Der schuleigene Admin, nur in dieser Schule (nicht `demo1`). */
    school_admin?: { email?: string; password?: string };
    accounts?: Partial<
      Record<
        SeedAccountRole,
        Array<{
          email?: string;
          password?: string;
          name?: string;
          staff_id?: number;
        }>
      >
    >;
    parents?: Array<{
      email?: string;
      password?: string;
      student_ids?: number[];
      guardian_id?: number;
    }>;
  };
}

/** Eltern-Login aus dem Seed, mit der Zahl seiner Kinder. */
export interface SeedParent {
  email: string;
  password: string;
  children: number;
}

type SeedAccountRole = "admin" | "betreuer" | "lehrkraft";

/**
 * Kontoart im Seed-Profil; ohne Angabe die Schul-Leitung (`admin`).
 * `school_admin` ist der Admin, den es nur in dieser Schule gibt.
 */
type SeedRole = SeedAccountRole | "school_admin";

interface SeedState {
  base_url?: string;
  created_at?: string;
  version?: string;
  default_profile?: string;
  profiles?: Record<string, SeedProfile>;
}

interface LoadSeedAccessOptions {
  profile?: string;
  statePath?: string;
  role?: SeedRole;
}

function defaultSeedStatePath(): string {
  return join(process.cwd(), "..", "backend", ".seed-state.json");
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/** Liest das Seed-Profil; null ohne Seed-Datei. */
export function readSeedProfile(options: LoadSeedAccessOptions): {
  key: string;
  profile: SeedProfile;
  baseUrl?: string;
  createdAt?: string;
} | null {
  const statePath = options.statePath ?? defaultSeedStatePath();
  let raw: string;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }

  const state = JSON.parse(raw) as SeedState;
  if (state.version !== SEED_STATE_VERSION) {
    throw new Error(
      `Unsupported seed state version ${JSON.stringify(state.version)}; supported version is ${SEED_STATE_VERSION}`,
    );
  }
  const profileKey = options.profile ?? state.default_profile;
  if (!profileKey) {
    throw new Error("Seed state has no default_profile");
  }
  const profile = state.profiles?.[profileKey];
  if (!profile) {
    const available = Object.keys(state.profiles ?? {})
      .sort()
      .join(", ");
    throw new Error(
      `Unknown demo school profile ${JSON.stringify(profileKey)}; available profiles: ${available}`,
    );
  }
  return {
    key: profileKey,
    profile,
    baseUrl: state.base_url,
    createdAt: state.created_at,
  };
}

/** Stand einer im Seed vorhandenen Anmeldung, ohne eine Anmeldung im Test zu schreiben. */
export function readSeedEnrollment(): { slug: string; token: string } | null {
  const profile = readSeedProfile({})?.profile;
  const slug = profile?.school?.tenant_slug;
  const token = profile?.entities?.enrollment?.requests?.find(
    (request) => request.status_token,
  )?.status_token;
  return slug && token ? { slug, token } : null;
}

/** Vollständige Eltern-Logins des Profils; leer ohne Seed-Datei. */
export function readSeedParents(
  options: Omit<LoadSeedAccessOptions, "role"> = {},
): SeedParent[] {
  const parents = readSeedProfile(options)?.profile.credentials?.parents ?? [];
  return parents.flatMap((parent) =>
    parent.email && parent.password
      ? [
          {
            email: parent.email,
            password: parent.password,
            children: parent.student_ids?.length ?? 0,
          },
        ]
      : [],
  );
}

export function readSeedAccess(
  options: LoadSeedAccessOptions = {},
): SeedAccess | null {
  const seed = readSeedProfile(options);
  if (!seed) return null;
  const { key: profileKey, profile } = seed;
  const role = options.role ?? "admin";
  const account =
    role === "school_admin"
      ? profile.credentials?.school_admin
      : profile.credentials?.accounts?.[role]?.[0];
  const slug = profile.school?.tenant_slug;
  if (!slug || !account?.email || !account.password) {
    throw new Error(
      `Demo school profile ${JSON.stringify(profileKey)} has no complete ${role === "admin" ? "school-admin" : role} access`,
    );
  }
  return { slug, email: account.email, password: account.password };
}

export function loadSeedAccess(
  options: LoadSeedAccessOptions = {},
): SeedAccess | null {
  const fileAccess = readSeedAccess(options);
  let slug = fileAccess?.slug;
  let email = fileAccess?.email;
  let password = fileAccess?.password;
  if (process.env.E2E_TENANT_SLUG) slug = process.env.E2E_TENANT_SLUG;
  if (process.env.E2E_TEST_EMAIL) email = process.env.E2E_TEST_EMAIL;
  if (process.env.E2E_TEST_PASSWORD) password = process.env.E2E_TEST_PASSWORD;
  return slug && email && password ? { slug, email, password } : null;
}
