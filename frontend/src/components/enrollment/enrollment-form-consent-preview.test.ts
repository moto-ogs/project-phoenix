import { describe, expect, it } from "vitest";
import type {
  PublicFormSchema,
  PublicLegalTexts,
} from "~/lib/enrollment-form-schema-api";
import {
  previewNeedsSchoolLegalTexts,
  resolvePreviewLegalTexts,
} from "./enrollment-form-consent";

// The template preview shows the health consent the live form adds (#2787).

const healthConsent = {
  key: "health_data",
  kind: "consent" as const,
  title: "Gesundheitsangaben",
  label: "Ich bin einverstanden.",
  text: "",
  required: false,
  sort_order: 45,
};

const schoolTexts: PublicLegalTexts = {
  agb: "",
  agb_document_url: "",
  dsgvo: "",
  email_contact: "",
  photo: "",
  terms_enabled: false,
  dsgvo_enabled: false,
  email_contact_enabled: false,
  photo_enabled: false,
  blocks: [],
  health_consent: healthConsent,
};

function template(withHealth: boolean): PublicFormSchema {
  return {
    id: "1",
    version: 1,
    fields: withHealth
      ? [
          {
            key: "health",
            label: "Gesundheit",
            type: "textarea",
            required: false,
            applies_to_child: true,
            sort_order: 0,
            target: "student.health_info",
          },
        ]
      : [],
    legal_blocks: [
      {
        key: "agb",
        kind: "terms",
        title: "AGB",
        label: "AGB",
        text: "AGB",
        required: true,
        enabled: true,
        sort_order: 10,
      },
      {
        key: "pool",
        kind: "consent",
        title: "Schwimmen",
        label: "Ja",
        text: "",
        required: false,
        enabled: true,
        sort_order: 50,
      },
    ],
  };
}

describe("resolvePreviewLegalTexts", () => {
  it("adds the health consent in sort order where the form asks for health information", () => {
    expect(previewNeedsSchoolLegalTexts(template(true))).toBe(true);
    const keys = resolvePreviewLegalTexts(
      template(true),
      schoolTexts,
    ).blocks.map((block) => block.key);
    expect(keys).toEqual(["agb", "health_data", "pool"]);
  });

  it("shows no health consent without a health field", () => {
    expect(previewNeedsSchoolLegalTexts(template(false))).toBe(false);
    const keys = resolvePreviewLegalTexts(
      template(false),
      schoolTexts,
    ).blocks.map((block) => block.key);
    expect(keys).toEqual(["agb", "pool"]);
  });
});
