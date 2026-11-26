import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  countAlreadyExistsRows,
  importBatchFailureMessage,
  readImportBatchFailure,
  readImportBatchRejection,
} from "./import-batch-result";

const abortingWrite = {
  row_number: 152,
  errors: [{ code: "creation_failed" }],
};

const committed = {
  total_rows: 205,
  created_count: 100,
  updated_count: 0,
  error_count: 1,
  errors: [abortingWrite],
};

const resultSchema = z.object({
  result: z.object({
    total_rows: z.number(),
    created_count: z.number(),
    updated_count: z.number(),
    error_count: z.number(),
    errors: z
      .array(
        z.object({
          row_number: z.number(),
          errors: z.array(z.object({ code: z.string() })),
        }),
      )
      .nullable(),
  }),
  rejection: z.object({ code: z.string(), details: z.unknown() }).optional(),
});

function envelope(result: Record<string, unknown>) {
  return {
    status: "error",
    error: "Import fehlgeschlagen",
    code: "import.import_batch_failed",
    details: { result },
  };
}

describe("readImportBatchFailure", () => {
  it("reads details.result from an import_batch_failed envelope", () => {
    expect(readImportBatchFailure(envelope(committed), resultSchema)).toEqual(
      committed,
    );
  });

  it("accepts a nil Go Errors slice", () => {
    expect(
      readImportBatchFailure(
        envelope({
          total_rows: 205,
          created_count: 100,
          updated_count: 0,
          error_count: 0,
          errors: null,
        }),
        resultSchema,
      ),
    ).toEqual({
      total_rows: 205,
      created_count: 100,
      updated_count: 0,
      error_count: 0,
      errors: null,
    });
  });

  it("ignores other error envelopes", () => {
    expect(
      readImportBatchFailure(
        {
          error: "Import fehlgeschlagen",
          message: "Import fehlgeschlagen",
        },
        resultSchema,
      ),
    ).toBeNull();
    expect(
      readImportBatchFailure(
        { code: "import.import_batch_failed" },
        resultSchema,
      ),
    ).toBeNull();
    expect(readImportBatchFailure(null, resultSchema)).toBeNull();
  });
});

describe("importBatchFailureMessage", () => {
  it("names saved rows and the aborting write, not an earlier skip", () => {
    const mixed = {
      total_rows: 205,
      created_count: 100,
      updated_count: 0,
      error_count: 2,
      errors: [
        {
          row_number: 2,
          errors: [{ code: "duplicate_check_failed" }],
        },
        abortingWrite,
      ],
    };
    expect(importBatchFailureMessage(mixed)).toBe(
      "100 Zeilen sind gespeichert. Zeile 152 hat den Rest angehalten. Bitte korrigiere diese Zeile. Lade die Datei danach erneut hoch. Die gespeicherten Zeilen bleiben.",
    );
    expect(
      importBatchFailureMessage({
        ...mixed,
        errors: [
          mixed.errors[0]!,
          { row_number: 152, errors: [{ code: "update_failed" }] },
        ],
      }),
    ).toContain("Zeile 152 hat den Rest angehalten");
  });

  it("does not name a row when the later batch failed without a write error", () => {
    expect(
      importBatchFailureMessage({
        total_rows: 205,
        created_count: 100,
        updated_count: 0,
        error_count: 0,
        errors: [],
      }),
    ).toBe(
      "100 Zeilen sind gespeichert. Der Rest hat nicht geklappt. Lade die Datei danach erneut hoch. Die gespeicherten Zeilen bleiben.",
    );
  });

  it("does not claim progress when the first batch rolled back", () => {
    const firstBatch = {
      total_rows: 40,
      created_count: 0,
      updated_count: 0,
      error_count: 1,
      errors: [{ row_number: 5, errors: [{ code: "creation_failed" }] }],
    };
    expect(importBatchFailureMessage(firstBatch)).toBe(
      "Zeile 5 hat nicht geklappt. Bitte korrigiere diese Zeile. Lade die Datei danach erneut hoch.",
    );
  });
});

describe("countAlreadyExistsRows", () => {
  it("counts already_exists rows and ignores other codes", () => {
    expect(
      countAlreadyExistsRows([
        { errors: [{ code: "already_exists" }] },
        { errors: [{ code: "already_exists" }, { code: "will_update" }] },
        { errors: [{ code: "creation_failed" }] },
        { errors: [] },
      ]),
    ).toBe(2);
    expect(countAlreadyExistsRows(null)).toBe(0);
  });
});

describe("readImportBatchRejection", () => {
  it("reads the refusal that stopped a batch (#3571)", () => {
    const rejection = {
      code: "students.child_quota_reached",
      details: { booked_places: 150, occupied_places: 150 },
    };
    expect(
      readImportBatchRejection(
        {
          code: "import.import_batch_failed",
          details: { result: committed, rejection },
        },
        resultSchema,
      ),
    ).toEqual(rejection);
    expect(
      readImportBatchRejection(
        {
          code: "import.import_batch_failed",
          details: {},
        },
        resultSchema,
      ),
    ).toBeNull();
    expect(
      readImportBatchRejection({ code: "other" }, resultSchema),
    ).toBeNull();
  });
});

describe("importBatchFailureMessage with a refusal", () => {
  it("names the saved rows, the refusal and that the saved rows stay", () => {
    expect(
      importBatchFailureMessage(
        {
          total_rows: 160,
          created_count: 100,
          updated_count: 0,
          error_count: 0,
          errors: [],
        },
        "Das Kinderkontingent Ihrer Schule ist voll.",
      ),
    ).toBe(
      "100 Zeilen sind gespeichert. Das Kinderkontingent Ihrer Schule ist voll. Die gespeicherten Zeilen bleiben.",
    );
  });

  it("is only the refusal when nothing was saved", () => {
    expect(
      importBatchFailureMessage(
        {
          total_rows: 3,
          created_count: 0,
          updated_count: 0,
          error_count: 0,
          errors: [],
        },
        "Das Kinderkontingent Ihrer Schule ist voll.",
      ),
    ).toBe("Das Kinderkontingent Ihrer Schule ist voll.");
  });
});
