import { afterEach, expect, it, vi } from "vitest";
import {
  deleteCostCenter,
  fetchExportProtocol,
  fetchExportRuns,
  fetchExportSettings,
} from "./traeger-finance-exports-api";

afterEach(() => vi.unstubAllGlobals());

it("reloads booking accounts after the BFF deletes a cost center with 204", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: {
          standard_account: "4400",
          cost_center_required: false,
          cost_centers: [
            {
              id: "8",
              scope: "school",
              scope_id: "2",
              valid_from: "2026-09-01",
              code: "K8",
            },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  const accounts = await deleteCostCenter("7");

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/traeger/finance-exports/booking-accounts/cost-centers/7",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/traeger/finance-exports/booking-accounts",
    expect.anything(),
  );
  expect(accounts.standardAccount).toBe("4400");
  expect(accounts.costCenters.map((center) => center.id)).toEqual(["8"]);
});

// #4693: the protocol carries the name of the exporting account.
it("maps who exported a file by name", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const file = {
    id: "3",
    file_number: 3,
    format: "datev",
    run_kind: "care",
    run_id: "7",
    run_label: "Oktober 2026",
    file_name: "EXTF_3.csv",
    invoice_count: 1,
    total_cents: 100,
    exported_by_account_id: "5",
    exported_by_you: false,
    exported_by_name: "",
    exported_at: "2026-11-09T10:00:00Z",
    submitted_at: null,
  };
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          total: 2,
          next_offset: null,
          files: [
            { ...file, exported_by_name: "Eva Müller" },
            { ...file, id: "2", exported_by_account_id: null },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  const page = await fetchExportProtocol();

  expect(
    page.items.map((entry) => [entry.exportedByAccount, entry.exportedByName]),
  ).toEqual([
    [true, "Eva Müller"],
    [false, ""],
  ]);
});

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ADR 0270 point 6: a mapping a newer backend stored with a value this build
// does not know is not shown or saved half-empty (#2353).
it("reads a mapping with an unknown value as none", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    json({
      sollstellung: {
        mapping: {
          columns: [{ field: "invoice_number", header: "Rechnung" }],
          delimiter: "~",
          decimal_separator: ",",
          date_format: "dd.mm.yyyy",
          encoding: "utf-8",
          header_row: true,
          file_name_pattern: "soll-{NR}.csv",
        },
        custom: true,
        updated_at: null,
      },
      file_numbers: { next: 1, started: false },
      datev: { ready: true, missing_settings: null, invalid_settings: null },
    }),
  );
  const settings = await fetchExportSettings();
  expect(settings.mapping).toBeNull();
});

it("leaves a run of an unknown kind out", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const run = {
    run_id: "7",
    label: "Oktober 2026",
    issued_on: "2026-11-01",
    invoice_count: 1,
    total_cents: 100,
    last_sollstellung: null,
    last_datev: null,
    exports: 0,
  };
  fetchMock.mockResolvedValue(
    json({
      total: 2,
      not_exported: 2,
      next_offset: null,
      runs: [
        { ...run, run_kind: "care" },
        { ...run, run_kind: "camp" },
      ],
    }),
  );
  const page = await fetchExportRuns();
  expect(page.items.map((item) => item.pathKind)).toEqual(["care-runs"]);
});
