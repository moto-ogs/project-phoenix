import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FormLegalBlock as WireFormLegalBlock,
  HolidayFormField as WireHolidayFormField,
} from "./contract/shared.generated";
import type { HolidayFormEditor as WireHolidayFormEditor } from "./contract/traeger-holiday-periods.generated";
import { fetchHolidayForm } from "./traeger-holiday-form-api";

// The editor saves the whole form back as a new version (#2353): every
// value this build does not know must fail the read, never turn into a
// guess the next save writes.

const FIELD: WireHolidayFormField = {
  key: "tetanus",
  label: "Tetanus-Impfschutz",
  type: "select",
  sort_order: 1,
  applies_to_child: true,
  options: [
    {
      label: "Ja",
      value: "ja",
      translations: { en: { label: { text: "Yes", source: "Ja" } }, tr: null },
    },
  ],
  health: true,
  share_with_host: true,
};

const CONDITIONAL: WireHolidayFormField = {
  key: "impfpass",
  label: "Impfpass liegt bei",
  type: "boolean",
  sort_order: 2,
  visible_when: {
    source: "field",
    field: "tetanus",
    operator: "eq",
    value: "ja",
  },
  health: false,
  share_with_host: false,
};

const BLOCK: WireFormLegalBlock = {
  key: "agb",
  kind: "terms",
  title: "AGB",
  label: "Ich stimme zu",
  text: "",
  required: true,
  enabled: true,
  sort_order: 0,
  source: "custom",
  display_mode: "pdf",
  attachments: [{ label: "AGB", document_id: "41", document_url: "" }],
  translations: { en: { title: { text: "Terms", source: "AGB" } }, fr: null },
};

function editor(
  overrides: Partial<WireHolidayFormEditor> = {},
): WireHolidayFormEditor {
  return {
    legal_blocks: [BLOCK],
    version: 3,
    fields: [FIELD, CONDITIONAL],
    address_requirement: "required",
    health_requirement: "optional",
    created_at: "2026-11-02T08:00:00Z",
    template: null,
    ...overrides,
  };
}

function answerWith(form: WireHolidayFormEditor): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "success", data: form }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

describe("fetchHolidayForm (#2353)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the decoded version without the languages the decoder left null", async () => {
    answerWith(editor({ template: [FIELD] }));

    const form = await fetchHolidayForm("5");

    expect(form.fields).toEqual([
      {
        ...FIELD,
        options: [
          {
            label: "Ja",
            value: "ja",
            translations: { en: { label: { text: "Yes", source: "Ja" } } },
          },
        ],
      },
      CONDITIONAL,
    ]);
    expect(form.template.map((field) => field.key)).toEqual(["tetanus"]);
    expect(form.legalBlocks).toEqual([
      {
        ...BLOCK,
        attachments: [{ label: "AGB", document_url: "41" }],
        translations: { en: { title: { text: "Terms", source: "AGB" } } },
      },
    ]);
    expect(form.addressRequirement).toBe("required");
    expect(form.healthRequirement).toBe("optional");
  });

  it("reads a period without a saved version as no address and optional health fields", async () => {
    answerWith(
      editor({
        legal_blocks: null,
        fields: null,
        address_requirement: "",
        health_requirement: "",
      }),
    );

    const form = await fetchHolidayForm("5");

    expect(form.fields).toEqual([]);
    expect(form.legalBlocks).toEqual([]);
    expect(form.addressRequirement).toBe("off");
    expect(form.healthRequirement).toBe("optional");
  });

  it.each([
    ["a field type", { fields: [{ ...FIELD, type: "signature_pad" }] }],
    [
      "a condition operator",
      {
        fields: [
          FIELD,
          {
            ...CONDITIONAL,
            visible_when: { source: "field", field: "tetanus", operator: "gt" },
          },
        ],
      },
    ],
    [
      "a condition source",
      {
        fields: [
          FIELD,
          {
            ...CONDITIONAL,
            visible_when: { source: "weekday", operator: "not_empty" },
          },
        ],
      },
    ],
    [
      "a condition value",
      {
        fields: [
          FIELD,
          {
            ...CONDITIONAL,
            visible_when: {
              source: "field",
              field: "tetanus",
              operator: "eq",
              value: { any: "ja" },
            },
          },
        ],
      },
    ],
    ["a legal block kind", { legal_blocks: [{ ...BLOCK, kind: "waiver" }] }],
    [
      "a legal block source",
      { legal_blocks: [{ ...BLOCK, source: "traeger" }] },
    ],
    [
      "a legal block display mode",
      { legal_blocks: [{ ...BLOCK, display_mode: "video" }] },
    ],
    ["an address requirement", { address_requirement: "sometimes" }],
    ["a health requirement", { health_requirement: "strict" }],
    ["a template field type", { template: [{ ...FIELD, type: "rating" }] }],
  ] satisfies [string, Partial<WireHolidayFormEditor>][])(
    "fails the read on %s this build does not know",
    async (_name, overrides) => {
      answerWith(editor(overrides));

      await expect(fetchHolidayForm("5")).rejects.toThrow(
        /^contract: HolidayFormEditor\..+ has an unknown value$/,
      );
    },
  );
});
