import { ApiError } from "./api-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { staffPayrollNumberService } from "./staff-api";

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ data }),
  } as Response;
}

function errorResponse(code: string, message = "backend error"): Response {
  return {
    ok: false,
    text: () => Promise.resolve(JSON.stringify({ code, detail: message })),
  } as Response;
}

describe("staffPayrollNumberService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads that the Träger keeps the number in its staff record", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ personnel_number: "70001", kept_by_traeger: true }),
    );

    await expect(staffPayrollNumberService.get("42")).resolves.toEqual({
      personnelNumber: "70001",
      keptByTraeger: true,
    });
  });

  it("fetches the current personnel number", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ personnel_number: "90001" }));

    await expect(staffPayrollNumberService.get("42")).resolves.toEqual({
      personnelNumber: "90001",
      keptByTraeger: false,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/staff/42/payroll-number", {
      method: "GET",
    });
  });

  it("updates the personnel number and note", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ personnel_number: "90002", version: "v-new" }),
    );

    await expect(
      staffPayrollNumberService.update("42", "90002", "Korrektur", "v-read"),
    ).resolves.toEqual({ personnelNumber: "90002", version: "v-new" });
    expect(fetchMock).toHaveBeenCalledWith("/api/staff/42/payroll-number", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personnel_number: "90002",
        note: "Korrektur",
        expected_version: "v-read",
      }),
    });
  });

  it("reports a failed read", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: "Forbidden",
    } as Response);

    await expect(staffPayrollNumberService.get("42")).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  // The client keeps the code; the catalog words the hint (#2514).
  it.each([
    ["workforce.personnel_number_taken"],
    ["workforce.personnel_number_invalid"],
  ])("keeps the update error code %s", async (code) => {
    fetchMock.mockResolvedValue(errorResponse(code));

    const failure = staffPayrollNumberService.update("42", "90002", "", "v-read");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ code });
  });

  it("uses the update fallback for an uncoded error", async () => {
    fetchMock.mockResolvedValue(errorResponse("other"));

    await expect(
      staffPayrollNumberService.update("42", "90002", "", "v-read"),
    ).rejects.toThrow("Personalnummer konnte nicht gespeichert werden");
  });
});
