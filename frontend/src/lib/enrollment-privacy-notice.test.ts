import { describe, expect, it } from "vitest";
import type { SchemaTab } from "./settings-api";
import { enrollmentPrivacyNotice } from "./enrollment-privacy-notice";

function schema(values: Record<string, unknown>): SchemaTab[] {
  return [
    {
      key: "enrollment",
      label: "Online-Anmeldung",
      categories: [
        {
          key: "allgemein",
          label: "Allgemein",
          items: Object.entries(values).map(([key, value]) => ({
            key,
            value,
          })),
        },
      ],
    },
  ] as unknown as SchemaTab[];
}

describe("enrollmentPrivacyNotice", () => {
  it("counts the notice only with its switch on and a text", () => {
    expect(
      enrollmentPrivacyNotice(
        schema({
          "enrollment.enabled": true,
          "enrollment.legal_dsgvo_enabled": true,
          "enrollment.legal_dsgvo_text": "Wir verarbeiten Ihre Daten.",
        }),
      ),
    ).toEqual({
      enrollmentEnabled: true,
      noticePresent: true,
      notificationRecipients: "",
    });
  });

  it.each([
    ["switch off", false, "Wir verarbeiten Ihre Daten."],
    ["blank text", true, "  \n "],
    ["no text", true, ""],
  ])("reports a missing notice with %s", (_case, on, text) => {
    expect(
      enrollmentPrivacyNotice(
        schema({
          "enrollment.enabled": true,
          "enrollment.legal_dsgvo_enabled": on,
          "enrollment.legal_dsgvo_text": text,
        }),
      ),
    ).toEqual({
      enrollmentEnabled: true,
      noticePresent: false,
      notificationRecipients: "",
    });
  });

  it("reads the stored notification recipients", () => {
    expect(
      enrollmentPrivacyNotice(
        schema({ "enrollment.notification_emails": "a@schule.example" }),
      )?.notificationRecipients,
    ).toBe("a@schule.example");
  });

  it("answers null without a schema or enrollment tab", () => {
    expect(enrollmentPrivacyNotice(null)).toBeNull();
    expect(enrollmentPrivacyNotice([])).toBeNull();
  });
});
