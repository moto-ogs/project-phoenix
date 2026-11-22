import { afterEach, expect, it, vi } from "vitest";
import { fetchKeyDateReport } from "./traeger-reports-api";

afterEach(() => vi.unstubAllGlobals());

// The figures as the catalog proxy hands them on: every field present.
const FIGURES = {
  children: 0,
  without_care_form: 0,
  staff: 0,
  children_per_staff: null,
  present_days: 0,
  sick_days: 0,
  excused_days: 0,
  absence_rate: null,
  places: 0,
  booked_places: 0,
  free_places: 0,
  booked: 0,
  open: 0,
  waitlisted: 0,
  demand: 0,
};
const GROUP = { figures: FIGURES, care_forms: null };

it("preserves the identity of unassigned districts through the report response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            key_date: "2026-10-15",
            as_of: "2026-11-15T10:00:00Z",
            template: null,
            sections: null,
            absence_window: null,
            schools: null,
            districts: [
              {
                ...GROUP,
                name: "Ohne Sozialraum",
                unmapped: false,
                schools: 1,
              },
              { ...GROUP, name: "Ohne Sozialraum", unmapped: true, schools: 2 },
            ],
            total: { ...GROUP, schools: 3 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  const report = await fetchKeyDateReport("2026-10-15", "12");
  expect(
    report.districts.map(({ name, unmapped, schools }) => ({
      name,
      unmapped,
      schools,
    })),
  ).toEqual([
    { name: "Ohne Sozialraum", unmapped: false, schools: 1 },
    { name: "Ohne Sozialraum", unmapped: true, schools: 2 },
  ]);
});
