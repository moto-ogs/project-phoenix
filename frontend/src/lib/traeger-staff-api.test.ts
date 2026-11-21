import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPayrollReport } from "./traeger-staff-exports-api";
import { fetchStaffRecord, previewStaffLink } from "./traeger-staff-api";
import { previewStaffImport } from "./traeger-staff-import-api";
import { fetchStaffProofList } from "./traeger-staff-proofs-api";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify({ data: body }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// The answers as the catalog proxy hands them on: IDs as strings, every
// field the decoder knows present (ADR 0270).
const RECORD = {
  id: "9",
  first_name: "Mira",
  last_name: "Sommer",
  personnel_number: null,
  has_financial: false,
  employments: [],
  financial: { iban: null, tax_id: null, social_security_number: null },
  changes: [
    {
      kind: "merged",
      field: "first_name",
      value: "Mia",
      occurred_at: "2027-01-04T08:00:00Z",
    },
    {
      kind: "changed",
      field: "nickname",
      value: "Mimi",
      occurred_at: "2027-01-04T08:00:00Z",
    },
  ],
  proofs: [],
  contracts: [
    {
      id: "4",
      kind: "werkstudent",
      starts_on: "2027-01-01",
      ends_on: null,
      pool: false,
      sites: [],
      holiday_weeks: [],
    },
  ],
};

describe("Träger staff clients read the decoded contract (#2353)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ADR 0270 point 6: a value a newer backend adds is not passed on as a
  // known one.
  it("keeps unknown kinds of a record apart from the known ones", async () => {
    fetchMock.mockResolvedValue(jsonResponse(RECORD));
    const record = await fetchStaffRecord("9");
    expect(record.contracts[0]?.kind).toBeUndefined();
    expect(record.changes.map((change) => [change.kind, change.field])).toEqual(
      [
        [undefined, "first_name"],
        ["changed", undefined],
      ],
    );
  });

  it("fails on a contract without its first day", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...RECORD,
        contracts: [
          { ...RECORD.contracts[0], kind: "part_time", starts_on: null },
        ],
      }),
    );
    await expect(fetchStaffRecord("9")).rejects.toThrow(
      "contract: required day staff_contract.starts_on is null",
    );
  });

  it("leaves a field of a link preview out that this build cannot choose", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        members: [],
        fields: [
          { field: "nickname", conflict: true, options: [] },
          { field: "last_name", conflict: false, options: [] },
        ],
      }),
    );
    const preview = await previewStaffLink({
      recordId: null,
      members: [],
      choices: {},
    });
    expect(preview.fields.map((field) => field.field)).toEqual(["last_name"]);
  });

  it("shows no known state for a proof state this build does not know", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        today: "2027-01-04",
        types: [],
        entries: [
          {
            staff_record_id: "9",
            first_name: "Mira",
            last_name: "Sommer",
            personnel_number: null,
            schools: [],
            type_id: "2",
            type_name: "Erste Hilfe",
            status: "suspended",
          },
        ],
        counts: { expired: 0, expiring_soon: 0, missing: 0, valid: 0 },
      }),
    );
    const list = await fetchStaffProofList();
    expect(list.entries[0]?.status).toBeUndefined();
  });

  it("keeps a row out for a reason this build does not know", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        encoding: "UTF-8",
        delimiter: ";",
        headers: [],
        mapping: {
          columns: {
            personnel_number: "",
            first_name: "",
            last_name: "",
            birthday: "",
            iban: "",
            tax_id: "",
            social_security_number: "",
          },
        },
        unmapped: ["nickname", "last_name"],
        applied: false,
        counts: {
          new: 0,
          complete: 0,
          duplicate: 0,
          conflict: 0,
          invalid: 1,
          imported: 0,
        },
        rows: [
          {
            line: 2,
            status: "quarantined",
            personnel_number: "7",
            first_name: "Mira",
            last_name: "Sommer",
            completes: ["nickname", "iban"],
            problems: [{ field: "nickname", code: "banned" }],
          },
        ],
      }),
    );
    const result = await previewStaffImport({
      file: new File(["x"], "personal.csv"),
      mapping: null,
    });
    expect(result.unmapped).toEqual(["last_name"]);
    const [row] = result.rows;
    expect(row?.status).toBeUndefined();
    expect(row?.completes).toEqual(["iban"]);
    expect(row?.problems).toEqual([{ field: undefined, code: "other" }]);
  });

  it("drops a payroll gap of a category this build cannot fill in", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        year: 2027,
        month: 1,
        format: "datev_next",
        contracts: 0,
        people: 0,
        schools: 0,
        line_count: 0,
        kinds: [],
        without_number: [],
        unconfigured: [
          { category: "bonus", kind: "minijob" },
          { category: "urlaub", kind: "minijob" },
        ],
        missing_client: false,
        no_wage_type: false,
        open_schools: [],
        contract_changes: [],
        ready: false,
      }),
    );
    const report = await fetchPayrollReport(2027, 1, "datev_lodas");
    expect(report.format).toBeUndefined();
    expect(report.unconfigured).toEqual([
      { category: "urlaub", kind: "minijob" },
    ]);
  });
});
