import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSigningView } from "./care-contract-signing-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function signingView(status: string, weekdays: readonly string[]) {
  return {
    contract_id: "7",
    organization_id: "3",
    status,
    amendment: false,
    traeger_name: "Träger",
    party_name: "Sabine Schneider",
    version: {
      child_first_name: "Mia",
      child_last_name: "Schneider",
      school_name: "OGS Nord",
      phase_name: "2026/27",
      effective_from: "2026-08-01",
      ends_on: null,
      price_cents: 4500,
      services: weekdays.map((weekday) => ({
        weekday,
        module_name: "Betreuung",
        ends_at: "16:00",
        last_day: null,
      })),
    },
    document_sha256: "abc",
    withdrawal_notice: null,
    signature: null,
  };
}

function stubAnswer(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

describe("fetchSigningView (#2353)", () => {
  it("leaves out a service on an unknown weekday and an unknown state", async () => {
    stubAnswer(signingView("archiviert", ["mon", "holiday"]));
    const view = await fetchSigningView({ kind: "link", link: "l" });
    expect(view.status).toBeUndefined();
    expect(view.services.map((service) => service.weekday)).toEqual(["mon"]);
  });

  it.each([false, true])(
    "keeps the stored amendment scope %s",
    async (amendment) => {
      stubAnswer({ ...signingView("aktiv", ["mon"]), amendment });
      const view = await fetchSigningView({ kind: "link", link: "l" });
      expect(view.amendment).toBe(amendment);
    },
  );

  it("fails on a contract version without its first day", async () => {
    stubAnswer({
      ...signingView("versendet", ["mon"]),
      version: {
        ...signingView("versendet", ["mon"]).version,
        effective_from: null,
      },
    });
    await expect(fetchSigningView({ kind: "link", link: "l" })).rejects.toThrow(
      "SigningContract.effective_from",
    );
  });
});
