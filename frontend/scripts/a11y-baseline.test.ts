import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  maxCounts,
  readBaseline,
  routeKey,
  selectsSubset,
  shrink,
  unlisted,
  type Baseline,
} from "./a11y-baseline";

const env = {
  NEXT_PUBLIC_PARENTS_HOSTNAME: "eltern.localhost:3000",
  NEXT_PUBLIC_TRAEGER_HOSTNAME: "traeger.localhost:3000",
  NEXT_PUBLIC_SCHOOL_HOSTNAME: "schule.localhost:3000",
};

const baseline: Baseline = {
  reasons: { "color-contrast": "#7110", "aria-prohibited-attr": "#7112" },
  routes: {
    "tenant /rooms": ["aria-prohibited-attr", "color-contrast"],
    "tenant /gone": ["color-contrast"],
  },
};

describe("routeKey", () => {
  it("names the portal by host and drops the tenant slug and the query", () => {
    expect(routeKey("http://vollbetrieb.localhost:3000/rooms?d=1", env)).toBe(
      "tenant /rooms",
    );
    expect(routeKey("http://eltern.localhost:3000/", env)).toBe("eltern /");
    expect(routeKey("http://traeger.localhost:3000/uebersicht", env)).toBe(
      "traeger /uebersicht",
    );
    expect(routeKey("http://localhost:3000/", env)).toBe("web /");
  });

  it("collapses numeric and UUID segments and the enrollment phase", () => {
    expect(routeKey("http://a.localhost:3000/students/42", env)).toBe(
      "tenant /students/[id]",
    );
    expect(
      routeKey(
        "http://eltern.localhost:3000/messages/0b6a2f1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
        env,
      ),
    ).toBe("eltern /messages/[id]");
    expect(routeKey("http://a.localhost:3000/anmeldung/herbst", env)).toBe(
      "tenant /anmeldung/[phase]",
    );
  });
});

describe("unlisted", () => {
  it("fails a rule the route does not list, however often a listed one occurs", () => {
    // #7196: dieselbe Seite zeigte je nach Woche 2, 6 oder 8 Stellen einer
    // gelisteten Regel. Die Anzahl entscheidet deshalb nicht mehr.
    expect(
      unlisted(baseline, {
        route: "tenant /rooms",
        counts: { "color-contrast": 40, "aria-prohibited-attr": 2 },
      }),
    ).toEqual([]);
    expect(
      unlisted(baseline, {
        route: "tenant /gone",
        counts: { "color-contrast": 1, "aria-prohibited-attr": 2 },
      }),
    ).toEqual([{ rule: "aria-prohibited-attr", count: 2 }]);
  });

  it("allows nothing on a route without an entry", () => {
    expect(
      unlisted(baseline, { route: "eltern /", counts: { "image-alt": 1 } }),
    ).toEqual([{ rule: "image-alt", count: 1 }]);
  });
});

describe("shrink", () => {
  it("drops rules a full run no longer finds, unseen routes and unused reasons, never adds", () => {
    const seen = maxCounts([
      { route: "tenant /rooms", counts: { "color-contrast": 2 } },
      { route: "tenant /rooms", counts: { "color-contrast": 3 } },
      { route: "eltern /", counts: { "image-alt": 5 } },
    ]);
    const { next, hints } = shrink(baseline, seen);
    expect(next).toEqual({
      reasons: { "color-contrast": "#7110" },
      routes: { "tenant /rooms": ["color-contrast"] },
    });
    expect(hints).toEqual([
      "tenant /rooms: aria-prohibited-attr behoben, Eintrag entfällt",
      "tenant /gone: in keinem Test geprüft, Eintrag entfällt",
    ]);
  });

  it("keeps a rule that only some scans of the route find", () => {
    const seen = maxCounts([
      { route: "tenant /rooms", counts: {} },
      {
        route: "tenant /rooms",
        counts: { "color-contrast": 9, "aria-prohibited-attr": 1 },
      },
      { route: "tenant /gone", counts: { "color-contrast": 2 } },
    ]);
    expect(shrink(baseline, seen)).toEqual({ next: baseline, hints: [] });
  });
});

describe("readBaseline", () => {
  it("reads the checked-in baseline: every rule has a reason, lists are sorted", () => {
    const checkedIn = readBaseline(
      join(import.meta.dirname, "..", "e2e", "a11y", "baseline.json"),
    );
    for (const [route, rules] of Object.entries(checkedIn.routes)) {
      expect(rules, route).toEqual([...new Set(rules)].sort());
      expect(rules.length, route).toBeGreaterThan(0);
    }
  });
});

describe("selectsSubset", () => {
  const cli = ["node", "playwright", "test"];
  it("accepts a full run with runner options", () => {
    expect(selectsSubset(cli)).toBe(false);
    expect(selectsSubset([...cli, "--workers", "4", "--reporter=list"])).toBe(
      false,
    );
  });
  it("rejects file filters and --grep", () => {
    expect(selectsSubset([...cli, "dienstplan"])).toBe(true);
    expect(selectsSubset([...cli, "--grep", "Krank"])).toBe(true);
    expect(selectsSubset([...cli, "--shard=1/2"])).toBe(true);
  });
});
