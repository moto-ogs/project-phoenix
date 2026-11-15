import { describe, expect, it } from "vitest";

import {
  distinctNodes,
  exceeding,
  maxCounts,
  routeKey,
  selectsSubset,
  shrink,
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
    "tenant /rooms": { "color-contrast": 4, "aria-prohibited-attr": 1 },
    "tenant /gone": { "color-contrast": 2 },
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

describe("exceeding", () => {
  it("fails only rules above the baseline, unknown routes at zero", () => {
    expect(
      exceeding(baseline, {
        route: "tenant /rooms",
        counts: { "color-contrast": 4, "aria-prohibited-attr": 2 },
      }),
    ).toEqual([{ rule: "aria-prohibited-attr", count: 2, allowed: 1 }]);
    expect(
      exceeding(baseline, { route: "eltern /", counts: { "image-alt": 1 } }),
    ).toEqual([{ rule: "image-alt", count: 1, allowed: 0 }]);
  });
});

describe("shrink", () => {
  it("only lowers, drops unseen routes and unused reasons, never adds", () => {
    const seen = maxCounts([
      { route: "tenant /rooms", counts: { "color-contrast": 2 } },
      { route: "tenant /rooms", counts: { "color-contrast": 3 } },
      { route: "eltern /", counts: { "image-alt": 5 } },
    ]);
    const { next, hints } = shrink(baseline, seen);
    expect(next).toEqual({
      reasons: { "color-contrast": "#7110" },
      routes: { "tenant /rooms": { "color-contrast": 3 } },
    });
    expect(hints).toEqual([
      "tenant /rooms: color-contrast 4 → 3",
      "tenant /rooms: aria-prohibited-attr 1 → 0",
      "tenant /gone: in keinem Test geprüft, Eintrag entfällt",
    ]);
  });

  it("keeps a value that a later scan exceeds", () => {
    const seen = maxCounts([
      { route: "tenant /rooms", counts: { "color-contrast": 9 } },
      { route: "tenant /gone", counts: { "color-contrast": 2 } },
    ]);
    expect(shrink(baseline, seen).next.routes["tenant /rooms"]).toEqual({
      "color-contrast": 4,
    });
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

describe("distinctNodes", () => {
  it("counts repeated list rows as one place, so test data does not move it", () => {
    expect(
      distinctNodes([
        { target: [".row:nth-child(1) > .text-gray-400"] },
        { target: [".row:nth-child(2) > .text-gray-400"] },
        { target: ["li:nth-of-type(12) > #student-42"] },
        { target: ["li:nth-of-type(3) > #student-7"] },
      ]),
    ).toBe(2);
  });

  it("ignores names in attribute values and ids, and the class order", () => {
    expect(
      distinctNodes([
        {
          target: ['button[aria-label="Lea Beck - Details"] > .mb-3.gap-1\\.5'],
        },
        {
          target: [
            'button[aria-label="Can Demir - Details"] > .gap-1\\.5.mb-3',
          ],
        },
        { target: ["#row-lea-beck > .text-xs"] },
        { target: ["#row-can-demir > .text-xs"] },
      ]),
    ).toBe(2);
  });

  it("keeps different places apart, including inside shadow roots", () => {
    expect(
      distinctNodes([
        { target: [".ml-6"] },
        { target: [".row > .text-gray-400"] },
        { target: [["my-widget", ".label"]] },
        { target: [["my-widget", ".hint"]] },
      ]),
    ).toBe(4);
  });
});
