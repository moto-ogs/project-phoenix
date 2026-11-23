import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelHolidayRegistration,
  confirmHolidayRegistration,
  fetchHolidayContribution,
} from "./traeger-contributions-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("traeger-contributions-api", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels a registration through the route of the Elternabrechnung (#5662)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { id: 7, status: "cancelled" } }),
    );

    await cancelHolidayRegistration("5", "7");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "/api/traeger/holiday-contributions/5/registrations/7/cancel",
    );
    expect(init?.method).toBe("POST");
  });

  it.each(["9007199254740993", undefined])(
    "preserves the cost bearer ID %s when confirming a registration",
    async (costBearerId) => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          data: {
            contribution: {
              children: [],
              total_cents: 0,
              exemption_available: false,
              benefits_exemption: false,
              frozen: true,
              confirmed_at: "2026-09-08T10:00:00Z",
            },
          },
        }),
      );

      await confirmHolidayRegistration("5", "7", false, "", costBearerId);

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        "/api/traeger/holiday-contributions/5/registrations/7/confirm",
      );
      expect(JSON.parse(init?.body as string)).toEqual({
        benefits_exemption: false,
        debtor_number: "",
        ...(costBearerId ? { cost_bearer_id: costBearerId } : {}),
      });
    },
  );

  it("reads that an invoice may need a correction (#5662)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          children: [],
          total_cents: 2250,
          exemption_available: false,
          benefits_exemption: false,
          frozen: true,
          confirmed_at: "2026-09-08T10:00:00Z",
          invoiced: true,
          correction_needed: true,
        },
      }),
    );

    const contribution = await fetchHolidayContribution("5", "7");

    expect(contribution.invoiced).toBe(true);
    expect(contribution.correctionNeeded).toBe(true);
  });
});
