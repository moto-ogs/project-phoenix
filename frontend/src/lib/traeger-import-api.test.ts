import { afterEach, describe, expect, it, vi } from "vitest";

import { previewContractImport } from "./traeger-care-contract-import-api";
import { previewFamilyChildrenImport } from "./traeger-family-children-import-api";

/**
 * The import uploads of the Träger portal answer through the catalog proxy
 * (#2352): the catalog envelope, every identifier as a string. A mapping
 * without a school still carries school_id 0, which arrives as "0".
 */
function answer(data: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ status: "success", message: "ok", data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const file = new File(["a;b\n"], "import.csv", { type: "text/csv" });

const base = {
  encoding: "utf-8",
  delimiter: ";",
  headers: ["a", "b"],
  unmapped: [],
  fingerprint: "f",
  applied: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("import uploads through the catalog proxy (#2352)", () => {
  it.each(["7", "9007199254740993", ""])(
    "preserves school ID %s in the family children import mapping",
    async (schoolId) => {
      const mapping = {
        columns: {
          child_first_name: "a",
          child_last_name: "b",
          child_birth_date: "",
          school: "",
          children: "",
          valid_from: "",
        },
        schoolId,
        validFrom: "",
      };
      const fetchMock = answer({
        ...base,
        mapping: { columns: {}, school_id: schoolId || "0" },
        schools: [],
        counts: {},
        rows: [],
      });
      await previewFamilyChildrenImport({ file, mapping });
      const familyForm = fetchMock.mock.calls[0]![1].body as FormData;
      expect(JSON.parse(String(familyForm.get("mapping")))).toEqual({
        columns: mapping.columns,
        school_id: schoolId || "0",
        valid_from: null,
      });
    },
  );

  it.each(["7", "9007199254740993", ""])(
    "preserves school ID %s in the contract import mapping",
    async (schoolId) => {
      const contractMapping = {
        columns: {
          child_first_name: "a",
          child_last_name: "b",
          child_birth_date: "",
          school: "",
          module: "",
          weekdays: "",
          effective_from: "",
          ends_on: "",
          concluded_on: "",
          party_first_name: "",
          party_last_name: "",
          party_email: "",
          debtor_number: "",
          family_children: "",
        },
        schoolId,
        moduleName: "",
        effectiveFrom: "",
      };
      const contractFetch = answer({
        ...base,
        mapping: {
          columns: {},
          school_id: schoolId || "0",
          module_name: "",
          effective_from: null,
        },
        schools: [],
        counts: {},
        rows: [],
      });
      await previewContractImport({ file, mapping: contractMapping });
      const contractForm = contractFetch.mock.calls[0]![1].body as FormData;
      expect(JSON.parse(String(contractForm.get("mapping")))).toEqual({
        columns: contractMapping.columns,
        school_id: schoolId || "0",
        module_name: "",
        effective_from: null,
      });
    },
  );

  it("reads the family children preview, no school chosen", async () => {
    const fetchMock = answer({
      ...base,
      mapping: { columns: {}, school_id: "0" },
      schools: [{ id: "7", name: "OGS Nord" }],
      counts: {},
      rows: [{ line: 2, status: "same", contract_id: "11", problems: null }],
    });

    const result = await previewFamilyChildrenImport({ file, mapping: null });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/traeger/family-children/imports/preview",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.mapping.schoolId).toBe("");
    expect(result.schools).toEqual([{ id: "7", name: "OGS Nord" }]);
    expect(result.rows[0]?.contractId).toBe("11");
  });

  // The office names the day the numbers count from (#7765); without one
  // the backend takes today and its answer names that day.
  it("sends and reads the day the family children count from", async () => {
    const data = {
      ...base,
      mapping: { columns: {}, school_id: "0", valid_from: "2026-11-22" },
      schools: [],
      counts: {},
      rows: [],
    };
    const first = answer(data);
    const columns = {
      child_first_name: "Vorname",
      child_last_name: "Nachname",
      child_birth_date: "",
      school: "",
      children: "Kinder",
      valid_from: "Gültig ab",
    };

    const result = await previewFamilyChildrenImport({
      file,
      mapping: { columns, schoolId: "7", validFrom: "2026-09-01" },
    });
    const second = answer(data);
    await previewFamilyChildrenImport({
      file,
      mapping: { columns, schoolId: "7", validFrom: "" },
    });

    const sent = (fetchMock: typeof first) => {
      const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
      return JSON.parse(String(body.get("mapping"))) as unknown;
    };
    expect(sent(first)).toEqual({
      columns,
      school_id: "7",
      valid_from: "2026-09-01",
    });
    expect(sent(second)).toEqual({ columns, school_id: "7", valid_from: null });
    expect(result.mapping.validFrom).toBe("2026-11-22");
  });

  it("keeps the school the contract import mapped", async () => {
    answer({
      ...base,
      mapping: {
        columns: {},
        school_id: "7",
        module_name: "",
        effective_from: null,
      },
      schools: [{ id: "7", name: "OGS Nord", modules: null }],
      debtor_number_scope: "payer",
      counts: { ready: 0, duplicate: 0, conflict: 0, invalid: 0, imported: 0 },
      rows: [],
    });

    const result = await previewContractImport({ file, mapping: null });

    expect(result.mapping.schoolId).toBe("7");
    expect(result.schools[0]?.id).toBe("7");
  });

  it("reads no school from a contract import without one", async () => {
    answer({
      ...base,
      mapping: {
        columns: {},
        school_id: "0",
        module_name: "",
        effective_from: null,
      },
      schools: null,
      debtor_number_scope: "payer",
      counts: { ready: 0, duplicate: 0, conflict: 0, invalid: 0, imported: 0 },
      rows: [],
    });

    const result = await previewContractImport({ file, mapping: null });

    expect(result.mapping.schoolId).toBe("");
  });
});
