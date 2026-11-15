import { afterEach, expect, it, vi } from "vitest";
import { fetchKeyDateReport } from "./traeger-reports-api";

afterEach(() => vi.unstubAllGlobals());

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
            districts: [
              { name: "Ohne Sozialraum", unmapped: false, schools: 1 },
              { name: "Ohne Sozialraum", unmapped: true, schools: 2 },
            ],
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
