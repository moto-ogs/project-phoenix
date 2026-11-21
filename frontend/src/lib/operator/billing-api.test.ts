import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingMonth,
  mapBillingKeyDateCount,
  operatorBillingService,
} from "./billing-api";

const { mockDownloadBlob } = vi.hoisted(() => ({ mockDownloadBlob: vi.fn() }));

vi.mock("~/lib/file-download", async () => {
  const actual = await vi.importActual<typeof import("~/lib/file-download")>(
    "~/lib/file-download",
  );
  return { ...actual, downloadBlob: mockDownloadBlob };
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("operator billing api", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    mockDownloadBlob.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves a captured school ID beyond JavaScript's safe number range", () => {
    expect(
      mapBillingKeyDateCount({
        school_id: "9007199254740993",
        school_name: "OGS Am Berg",
        organization_name: "Träger Nord",
        period: "2026-08-01",
        key_date: "2026-08-15",
        active_students: 120,
        active_terminals: 3,
        recorded_at: "2026-08-15T04:00:00Z",
      }),
    ).toEqual({
      schoolId: "9007199254740993",
      schoolName: "OGS Am Berg",
      organizationName: "Träger Nord",
      period: "2026-08-01",
      keyDate: "2026-08-15",
      activeStudents: 120,
      activeTerminals: 3,
      recordedAt: "2026-08-15T04:00:00Z",
    });
    expect(billingMonth("2026-08-01")).toBe("2026-08");
  });

  it("sends the new key day as key_day", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        key_day: 10,
        next_key_date: "2026-10-10",
        updated_at: "2026-09-22T10:00:00Z",
      }),
    );

    const result = await operatorBillingService.updateKeyDay(10);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operator/billing/key-day",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ key_day: 10 }),
      }),
    );
    expect(result).toEqual({
      keyDay: 10,
      nextKeyDate: "2026-10-10",
      updatedAt: "2026-09-22T10:00:00Z",
      overrides: [],
    });
  });

  it("sets a school's own key day with PUT and resets a Träger's with DELETE (#7301)", async () => {
    const override = {
      scope: "school",
      id: "9007199254740993",
      organization_id: "4",
      name: "OGS Am Bach",
      organization_name: "Träger Nord",
      key_day: 5,
      next_key_date: "2026-12-05",
      updated_at: "2026-11-10T09:00:00Z",
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        key_day: 15,
        next_key_date: "2026-11-15",
        updated_at: "2026-11-01T08:00:00Z",
        overrides: [override],
      }),
    );
    const updated = await operatorBillingService.setKeyDayOverride(
      "school",
      "9007199254740993",
      5,
    );
    expect(updated.overrides).toEqual([
      {
        scope: "school",
        id: "9007199254740993",
        organizationId: "4",
        name: "OGS Am Bach",
        organizationName: "Träger Nord",
        keyDay: 5,
        nextKeyDate: "2026-12-05",
        updatedAt: "2026-11-10T09:00:00Z",
      },
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/operator/billing/key-day-overrides/schools/9007199254740993",
      expect.objectContaining({ method: "PUT", body: '{"key_day":5}' }),
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        key_day: 15,
        next_key_date: "2026-11-15",
        updated_at: "2026-11-01T08:00:00Z",
        overrides: null,
      }),
    );
    const reset = await operatorBillingService.resetKeyDayOverride(
      "organization",
      "4",
    );
    expect(reset.overrides).toEqual([]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/operator/billing/key-day-overrides/organizations/4",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("leaves out an override of a scope this build does not know (#2353)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        key_day: 15,
        next_key_date: "2026-11-15",
        updated_at: "2026-11-01T08:00:00Z",
        overrides: [
          {
            scope: "region",
            id: "4",
            organization_id: "4",
            name: "Region Nord",
            organization_name: "",
            key_day: 3,
            next_key_date: "2026-12-03",
            updated_at: "2026-11-01T08:00:00Z",
          },
        ],
      }),
    );
    const keyDay = await operatorBillingService.getKeyDay();
    // Resetting it as a Träger's override would delete the wrong level.
    expect(keyDay.keyDay).toBe(15);
    expect(keyDay.overrides).toEqual([]);
  });

  it("maps an empty list as no captured months", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await expect(operatorBillingService.listKeyDateCounts()).resolves.toEqual(
      [],
    );
  });

  it("downloads one month under the backend's file name", async () => {
    fetchMock.mockResolvedValue(
      new Response("csv", {
        status: 200,
        headers: {
          "Content-Disposition":
            'attachment; filename="stichtagszahlen-2026-08.csv"',
        },
      }),
    );

    await operatorBillingService.downloadKeyDateCounts("2026-08");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/operator/billing/key-date-counts/export?month=2026-08",
      { credentials: "include" },
    );
    expect(mockDownloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "stichtagszahlen-2026-08.csv",
    );
  });

  it("uses a Stichtagszahlen file name when the backend sends none", async () => {
    fetchMock.mockResolvedValue(new Response("csv", { status: 200 }));

    await operatorBillingService.downloadKeyDateCounts("2026-08");

    expect(mockDownloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "stichtagszahlen-2026-08.csv",
    );
  });

  it("fails instead of saving an error page as CSV", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      operatorBillingService.downloadKeyDateCounts(),
    ).rejects.toMatchObject({ status: 500, code: "general.server" });
    expect(mockDownloadBlob).not.toHaveBeenCalled();
  });

  it("keeps the wire code of a failed export", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: "general.unavailable", instance: "req-9" }),
        { status: 503 },
      ),
    );

    await expect(
      operatorBillingService.downloadKeyDateCounts(),
    ).rejects.toMatchObject({
      code: "general.unavailable",
      requestId: "req-9",
    });
  });

  it("turns a network failure into general.unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      operatorBillingService.downloadKeyDateCounts(),
    ).rejects.toMatchObject({ code: "general.unavailable" });
  });
});
