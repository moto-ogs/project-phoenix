import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOverrunSummary,
  overrunCoverage,
  schoolHasFigures,
} from "./traeger-care-time-overruns-api";
import { fetchCareRules } from "./traeger-care-reductions-api";

const request = vi.hoisted(() => vi.fn());
vi.mock("~/lib/bff-fetch", () => ({ bffJson: request }));
afterEach(() => request.mockReset());

const FIGURES = {
  children: 0,
  overrun_days: 0,
  unbooked_days: 0,
  extra_minutes: 0,
};

describe("care time overruns (#2353)", () => {
  // Go writes an empty first day of a school without check-ins as null: its
  // zeros say nothing, so the evaluation has no figures for it.
  it("reads a school without data as one without figures", async () => {
    request.mockResolvedValue({
      from: "2026-09-01",
      to: "2026-09-30",
      tolerance_minutes: 5,
      total: FIGURES,
      schools: [
        {
          school_id: "3",
          school_name: "OGS Sonnenhof",
          data_from: null,
          compared_days: 0,
          uncompared_days: 0,
          figures: FIGURES,
        },
      ],
      children: [],
    });
    const evaluation = await fetchOverrunSummary({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    const [school] = evaluation.schools;
    expect(school?.dataFrom).toBeNull();
    expect(schoolHasFigures(school!, evaluation.to)).toBe(false);
    expect(overrunCoverage(evaluation)).toBe("none");
  });
});

describe("care rules (#2353)", () => {
  // ADR 0270 point 6: the chain editor cannot show a rule of a kind a newer
  // backend adds; it is left out instead of passing as a known kind.
  it("leaves a rule of an unknown kind out", async () => {
    const rule = {
      id: "1",
      service: "care",
      valid_from: "2026-08-01",
      valid_until: null,
      sibling_from_child: null,
      discount_basis_points: 1000,
      discount_cents: null,
      note: "",
      name: "Regel",
      school_ids: ["3"],
      care_offering_ids: null,
      count_school_ids: null,
      price_cents: null,
      cap_cents: null,
      tariff_sibling_price: false,
      counts_family_children: false,
      updated_at: "2026-08-01T08:00:00+02:00",
    };
    request.mockResolvedValue({
      rules: [
        { ...rule, kind: "sibling" },
        { ...rule, id: "2", kind: "foster_child" },
      ],
      schools: [],
      modules: [],
    });
    const set = await fetchCareRules();
    expect(set.rules.map((entry) => [entry.id, entry.kind])).toEqual([
      ["1", "sibling"],
    ]);
  });
});
