import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ContractImportMapping,
  previewContractImport,
} from "./traeger-care-contract-import-api";

// Go reads the school of the mapping as ident.ID: a string or a number,
// never an empty string (ADR 0300).
describe("previewContractImport mapping", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sentMapping(schoolId: string): Promise<unknown> {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const mapping = {
      columns: {},
      schoolId,
      moduleName: "",
      effectiveFrom: "",
    } as unknown as ContractImportMapping;
    await previewContractImport({
      file: new File(["a;b"], "vertraege.csv"),
      mapping,
    }).catch(() => undefined);
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    return JSON.parse(body.get("mapping") as string);
  }

  it("sends the chosen school as a string", async () => {
    await expect(sentMapping("5")).resolves.toMatchObject({ school_id: "5" });
  });

  it("sends no school as zero", async () => {
    await expect(sentMapping("")).resolves.toMatchObject({ school_id: "0" });
  });
});
