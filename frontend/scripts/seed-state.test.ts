import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readSeedAccess,
  readSeedParents,
  SEED_STATE_VERSION,
} from "./seed-state";

function writeState(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
}

const tempDirs: string[] = [];

function statePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-seed-state-"));
  tempDirs.push(dir);
  return join(dir, "state.json");
}

function profile(slug: string, email: string) {
  return {
    school: { tenant_slug: slug },
    credentials: {
      accounts: { admin: [{ email, password: "Test1234%" }] },
    },
  };
}

describe("seed-state profile reader", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true });
    }
  });

  it("selects the default and an explicit profile", () => {
    const path = statePath();
    writeState(path, {
      version: SEED_STATE_VERSION,
      default_profile: "vollbetrieb",
      profiles: {
        vollbetrieb: profile("vollbetrieb", "vollbetrieb@example.test"),
        klein: profile("klein", "klein@example.test"),
      },
    });

    expect(readSeedAccess({ statePath: path })).toEqual({
      slug: "vollbetrieb",
      email: "vollbetrieb@example.test",
      password: "Test1234%",
    });
    expect(readSeedAccess({ statePath: path, profile: "klein" })?.slug).toBe(
      "klein",
    );
  });

  it("selects the school's own admin", () => {
    const path = statePath();
    const manuell = profile("manuell", "demo1@example.test");
    writeState(path, {
      version: SEED_STATE_VERSION,
      default_profile: "manuell",
      profiles: {
        manuell: {
          ...manuell,
          credentials: {
            ...manuell.credentials,
            school_admin: {
              email: "manuell-admin@example.test",
              password: "Manuell1234%",
            },
          },
        },
      },
    });

    expect(readSeedAccess({ statePath: path, role: "school_admin" })).toEqual({
      slug: "manuell",
      email: "manuell-admin@example.test",
      password: "Manuell1234%",
    });
    expect(readSeedAccess({ statePath: path })?.email).toBe(
      "demo1@example.test",
    );
  });

  it("rejects unknown contract versions", () => {
    const path = statePath();
    writeState(path, { version: "2" });

    expect(() => readSeedAccess({ statePath: path })).toThrow(
      "Unsupported seed state version",
    );
  });

  it("rejects unknown profiles and lists valid keys", () => {
    const path = statePath();
    writeState(path, {
      version: SEED_STATE_VERSION,
      default_profile: "vollbetrieb",
      profiles: { vollbetrieb: profile("vollbetrieb", "admin@example.test") },
    });

    expect(() => readSeedAccess({ statePath: path, profile: "fehlt" })).toThrow(
      "available profiles: vollbetrieb",
    );
  });
});

describe("readSeedParents", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true });
    }
  });

  it("lists complete parent logins of the default profile with their child count", () => {
    const path = statePath();
    writeState(path, {
      version: SEED_STATE_VERSION,
      default_profile: "vollbetrieb",
      profiles: {
        vollbetrieb: {
          credentials: {
            parents: [
              {
                email: "a@example.test",
                password: "Test1234%",
                student_ids: [1, 2],
              },
              { email: "ohne-passwort@example.test" },
              {
                email: "b@example.test",
                password: "Test1234%",
                student_ids: [3],
              },
            ],
          },
        },
      },
    });

    expect(readSeedParents({ statePath: path })).toEqual([
      { email: "a@example.test", password: "Test1234%", children: 2 },
      { email: "b@example.test", password: "Test1234%", children: 1 },
    ]);
  });

  it("returns an empty list without a seed file and rejects another version", () => {
    expect(readSeedParents({ statePath: statePath() })).toEqual([]);
    const path = statePath();
    writeState(path, { version: "0", default_profile: "x", profiles: {} });
    expect(() => readSeedParents({ statePath: path })).toThrow(/version/);
  });
});
