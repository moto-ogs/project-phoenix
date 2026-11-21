import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBillingRun, releaseBillingRun } from "./traeger-billing-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PREVIEW = {
  id: 9,
  service: "holiday",
  holiday_period_id: 5,
  period_name: "Winterferien 2027",
  service_from: "2027-01-04",
  service_until: "2027-01-15",
  status: "calculated",
  created_at: "2026-09-01T08:00:00Z",
  released_at: null,
  issued_on: null,
  document_count: null,
  total_cents: null,
  documents: [],
  preview_count: 2,
  preview_cents: 3000,
  unbilled: 0,
  number_pattern: "FE-{NNNN}",
  number_range_set: true,
  letters: null,
  document_kind: "invoice",
  fingerprint: "c0ffee",
};

describe("traeger-billing-api release (#6506)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends back the fingerprint of the checked preview", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: PREVIEW }));
    const checked = await fetchBillingRun("9");
    expect(checked.fingerprint).toBe("c0ffee");

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: { ...PREVIEW, status: "released", fingerprint: "" },
      }),
    );
    await releaseBillingRun(checked);

    const [path, init] = fetchMock.mock.calls[1] ?? [];
    expect(String(path)).toContain("/api/traeger/billing-runs/9/release");
    expect(JSON.parse(String(init?.body))).toEqual({
      document_count: 2,
      total_cents: 3000,
      fingerprint: "c0ffee",
      document_kind: "invoice",
    });
  });
});

// ADR 0270 point 6: a value a newer backend adds is not passed on as a known
// one. A direct debit that is not collected for a new reason stays a gap.
describe("traeger-billing-api unknown values (#2353)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps unknown run, document and payment values apart", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: {
          ...PREVIEW,
          status: "archived",
          service_from: null,
          due_dates: [
            { payment_method: "cash", due_on: "2027-02-01" },
            { payment_method: "transfer", due_on: "2027-02-15" },
          ],
          documents: [
            {
              id: "0",
              kind: "reminder",
              registration_child_id: "0",
              recipient_kind: "",
              payment: {
                method: "cash",
                due_on: null,
                due_source: "term",
                debit_gap: "bank_closed",
              },
              children: [],
            },
          ],
        },
      }),
    );
    const run = await fetchBillingRun("9");
    expect(run.status).toBeUndefined();
    expect(run.serviceFrom).toBeNull();
    expect(run.dueDates).toEqual([
      { paymentMethod: "transfer", dueOn: "2027-02-15" },
    ]);
    expect(run.documents[0]).toMatchObject({
      id: "",
      kind: undefined,
      registrationChildId: "",
      recipientKind: "",
      payment: { method: undefined, dueOn: null, debitGap: "other" },
    });
  });
});
