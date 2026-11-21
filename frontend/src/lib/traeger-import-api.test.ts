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
