import { describe, expect, it } from "vitest";
import type { PublicLegalBlock } from "~/lib/enrollment-form-schema-api";
import { consentsToUnchangedTexts } from "./enrollment-form-consent";

// ADR 0311: a new form version keeps a parent's tick only for a legal text
// that did not change; a changed or removed text asks again.

const block = (key: string, text: string): PublicLegalBlock => ({
  key,
  kind: "consent",
  title: key,
  label: "Ich bin einverstanden.",
  text,
  required: true,
  sort_order: 10,
});

describe("consentsToUnchangedTexts", () => {
  it("clears the ticks of changed and removed texts only", () => {
    const before = [block("agb", "AGB 2026"), block("photo", "Fotos")];
    const after = [block("agb", "AGB 2027"), block("photo", "Fotos")];
    expect(
      consentsToUnchangedTexts({ agb: true, photo: true }, before, after),
    ).toEqual({ photo: true });
    expect(
      consentsToUnchangedTexts({ agb: true, photo: true }, before, [
        block("photo", "Fotos"),
      ]),
    ).toEqual({ photo: true });
  });

  it("keeps the same object when every text stayed", () => {
    const blocks = [block("agb", "AGB 2026")];
    const consents = { agb: true };
    expect(consentsToUnchangedTexts(consents, blocks, [...blocks])).toBe(
      consents,
    );
  });
});
