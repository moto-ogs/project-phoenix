import { describe, expect, it } from "vitest";

import {
  CHILD_QUOTA_REACHED_CODE,
  childQuotaMessage,
} from "./child-quota-error";

function codedError(code: string, details?: unknown) {
  return Object.assign(new Error("child quota reached"), { code, details });
}

describe("childQuotaMessage", () => {
  it("names the Kinderkontingent with the booked and occupied children", () => {
    const error = codedError(CHILD_QUOTA_REACHED_CODE, {
      booked_places: 50,
      occupied_places: 50,
      requested_places: 1,
    });

    expect(childQuotaMessage(error)).toBe(
      "Das Kinderkontingent deiner Schule ist voll. Die Kontingentzahl beträgt 50 von 50 Kindern. Für weitere Kinder melde dich bitte beim moto-Team.",
    );
  });

  it("does not treat obsolete string bodies as coded errors", () => {
    const error = Object.assign(new Error("HTTP 409"), {
      status: 409,
      body: JSON.stringify({ code: CHILD_QUOTA_REACHED_CODE }),
    });
    expect(childQuotaMessage(error)).toBeNull();
  });

  it("stays readable without numbers", () => {
    expect(childQuotaMessage(codedError(CHILD_QUOTA_REACHED_CODE))).toBe(
      "Das Kinderkontingent deiner Schule ist voll. Für weitere Kinder melde dich bitte beim moto-Team.",
    );
  });

  it("ignores every other error", () => {
    expect(childQuotaMessage(codedError("students.other"))).toBeNull();
    expect(childQuotaMessage(new Error("child quota reached"))).toBeNull();
    expect(
      childQuotaMessage(Object.assign(new Error("x"), { body: "not json" })),
    ).toBeNull();
    expect(childQuotaMessage(undefined)).toBeNull();
  });
});
