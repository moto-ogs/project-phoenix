import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTraegerOccupancy } from "./traeger-occupancy-api";
import { fetchTraegerUtilization } from "./traeger-utilization-api";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify({ data: body }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// The answer as the catalog proxy hands it on (ADR 0270): IDs as strings,
// every field present, a calendar day Go left empty as null.
const UTILIZATION = {
  from: "2027-01-04",
  to: "2027-01-08",
  days: ["2027-01-04", "2027-01-05"],
  as_of: "2027-01-08T10:00:00Z",
  schools: [
    {
      id: "3",
      name: "OGS Süd",
      slug: "ogs-sued",
      subdomain: "ogs-sued",
      city: "Köln",
      places: 40,
      booked: [30, 31],
      booked_places: [30, 31],
      present: [28, null],
      attendance_from: null,
      room_data_from: null,
      offerings: [
        { id: "8", name: "Früh", capacity: null, active: true, booked: null },
      ],
      rooms: null,
    },
  ],
};

describe("Träger evaluations read the decoded contract (#2353)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a utilization window with string IDs", async () => {
    fetchMock.mockResolvedValue(jsonResponse(UTILIZATION));
    const utilization = await fetchTraegerUtilization({
      from: "2027-01-04",
      to: "2027-01-08",
    });
    expect(utilization.days).toEqual(["2027-01-04", "2027-01-05"]);
    expect(utilization.schools[0]).toMatchObject({
      id: "3",
      offerings: [{ id: "8", capacity: null, booked: [] }],
      rooms: [],
    });
  });

  // A day of the window is a column of every series: null there is a broken
  // answer, not an empty column.
  it("fails on a window day without its date", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...UTILIZATION, days: ["2027-01-04", null] }),
    );
    await expect(
      fetchTraegerUtilization({ from: "2027-01-04", to: "2027-01-08" }),
    ).rejects.toThrow("contract: required day utilization.days is null");
  });

  it("fails on an occupancy without its day", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ day: null, as_of: "2027-01-08T10:00:00Z", schools: [] }),
    );
    await expect(fetchTraegerOccupancy()).rejects.toThrow(
      "contract: required day occupancy.day is null",
    );
  });
});
