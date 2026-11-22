import { afterEach, describe, expect, it, vi } from "vitest";

import { previewOfferingCorrection } from "./traeger-offering-correction-api";

/**
 * The correction of the modules (#7764) answers through the catalog proxy
 * like the contract import: the catalog envelope, every identifier as a
 * string, lists that may arrive as null.
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

const file = new File(["Vertrag;Wochentag\n"], "module.csv", {
  type: "text/csv",
});

afterEach(() => vi.unstubAllGlobals());

describe("offering correction upload", () => {
  it("sends the day and maps the contracts of the preview", async () => {
    const fetchMock = answer({
      encoding: "utf-8",
      delimiter: ";",
      headers: ["Vertrag", "Wochentag", "Bisheriges_Modul", "Neues_Modul"],
      missing_columns: ["target_offering", "something_new"],
      effective_from: "2026-10-01",
      fingerprint: "f",
      applied: false,
      counts: { ready: 1, unchanged: 0, held: 0, invalid: 0, corrected: 0 },
      contracts: [
        {
          reference: "41",
          line: 2,
          contract_id: "41",
          school_name: "OGS Nord",
          child_first_name: "Mia",
          child_last_name: "Beispiel",
          status: "ready",
          effective_from: "2026-10-01",
          version_number: 2,
          changes: [{ weekdays: null, from: "Alt", to: "Neu" }],
          problems: [{ line: 3, field: "weekday", code: "invalid" }],
          hints: null,
        },
      ],
    });

    const result = await previewOfferingCorrection({
      file,
      effectiveFrom: "2026-10-01",
    });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(
      "/api/traeger/contract-imports/offering-corrections/preview",
    );
    expect((init.body as FormData).get("effective_from")).toBe("2026-10-01");
    expect((init.body as FormData).get("fingerprint")).toBeNull();
    // A column this build does not know is left out.
    expect(result.missingColumns).toEqual(["target_offering"]);
    expect(result.contracts[0]).toMatchObject({
      contractId: "41",
      versionNumber: 2,
      changes: [{ weekdays: [], from: "Alt", to: "Neu" }],
      problems: [{ line: 3, field: "weekday", code: "invalid" }],
      hints: [],
    });
  });
});
