import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyStartCardResponse } from "./contract/parent-me.generated";
import { ApiError } from "./api-error";
import { getFamilyStart } from "./parent-api";
import { narrowNextFamilyRead, readParentFamily } from "./parent-family-start";

vi.mock("./parent-api", () => ({
  getFamilyStart: vi.fn(),
  UNKNOWN_CHILD_TODAY: { state: "unknown", at_ogs: null },
}));
const serverDay = { day: "2026-11-25", day_remaining_seconds: 86400 };
function card(
  id: string,
  version = "one",
  enabled = true,
): FamilyStartCardResponse {
  return {
    access_version: version,
    child: { student_id: id, tenant_id: "school", care_ended: false },
    features: { notes_enabled: enabled },
    today: { state: "present", at_ogs: true },
  } as FamilyStartCardResponse;
}
const read = vi.mocked(getFamilyStart);
beforeEach(() => {
  read.mockReset();
});

describe("family card updates", () => {
  it("reads only the event child, removes it on revocation, and replaces the family on reconciliation", async () => {
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("1"), card("2")],
    });
    const family = await readParentFamily(undefined);
    narrowNextFamilyRead(family, "2");
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [],
    });
    const updated = await readParentFamily(family);
    expect(updated.children).toEqual([card("1").child]);
    expect(updated.features).not.toHaveProperty("2");
    expect(updated.today).not.toHaveProperty("2");
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [],
    });
    expect((await readParentFamily(updated)).children).toEqual([]);
    expect(read.mock.calls).toEqual([[undefined], ["2"], [undefined]]);
  });
  it("does not restore previous permissions from a partial response after a relationship change", async () => {
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("1"), card("2")],
    });
    const family = await readParentFamily(undefined);
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [
        { ...card("1", "changed"), features: null, today: null },
        card("2"),
      ],
    });
    const updated = await readParentFamily(family);
    expect(updated.features["1"]).toBeUndefined();
    expect(updated.today["1"]?.state).toBe("unknown");
    expect(updated.featureErrors["1"]).toMatchObject({ status: 503 });
    expect(updated.features["2"]?.notes_enabled).toBe(true);
  });
  it("reconciles the family at server midnight and does not carry a prior day's partial fields", async () => {
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("1"), card("2")],
    });
    const family = await readParentFamily(undefined);
    const tomorrow = "2026-11-26";
    narrowNextFamilyRead(family, "1");
    read.mockResolvedValueOnce({
      ...serverDay,
      day: tomorrow,
      cards: [card("1")],
    });
    read.mockResolvedValueOnce({
      ...serverDay,
      day: tomorrow,
      cards: [card("1"), { ...card("2"), features: null, today: null }],
    });
    const rollover = await readParentFamily(family);
    expect(rollover.needsDayReconciliation).toBe(true);
    expect(rollover.features["2"]).toBeUndefined();
    expect(rollover.today["2"]).toBeUndefined();
    const current = await readParentFamily(rollover);
    expect(current.needsDayReconciliation).toBe(false);
    expect(current.day).toBe(tomorrow);
    expect(current.features["2"]).toBeUndefined();
    expect(current.today["2"]?.state).toBe("unknown");
    expect(read.mock.calls).toEqual([[undefined], ["1"], [undefined]]);
  });
  it("keeps a concurrent sibling success when another card read fails", async () => {
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("1"), card("2")],
    });
    const family = await readParentFamily(undefined);
    narrowNextFamilyRead(family, "1");
    const failure = new ApiError("unavailable", 503);
    read.mockRejectedValueOnce(failure);
    const first = readParentFamily(family);
    narrowNextFamilyRead(family, "2");
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [],
    });
    const updated = await readParentFamily(family);
    await first;
    expect(updated.featureErrors["1"]).toBe(failure);
    expect(updated.children).toEqual([card("1").child]);
    expect(updated.features["1"]).toEqual(card("1").features);
  });
  it("applies a later card to an in-flight authoritative roster, not to the old family", async () => {
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("1"), card("2")],
    });
    const family = await readParentFamily(undefined);
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("2")],
    });
    const full = readParentFamily(family);
    narrowNextFamilyRead(family, "2");
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("2", "v2", false)],
    });
    const updated = await readParentFamily(family);
    await full;
    expect(updated.children).toEqual([card("2").child]);
    expect(updated.features["2"]?.notes_enabled).toBe(false);
  });
  it("does not read a targeted card ahead of a concurrent roster decision", async () => {
    read.mockResolvedValueOnce({ ...serverDay, cards: [card("1")] });
    const family = await readParentFamily(undefined);
    let linked = true;
    let confirmRemoval!: () => void;
    const roster = new Promise<void>((resolve) => {
      confirmRemoval = resolve;
    });
    read.mockImplementation(async (id) => {
      if (!id) {
        await roster;
        linked = false;
      }
      return { ...serverDay, cards: linked ? [card("1")] : [] };
    });
    const full = readParentFamily(family);
    narrowNextFamilyRead(family, "1");
    const targeted = readParentFamily(family);
    confirmRemoval();
    await full;
    expect((await targeted).children).toEqual([]);
  });

  it("keeps the newer child update when the older reply arrives last", async () => {
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("1")],
    });
    const family = await readParentFamily(undefined);
    let finish!: (response: {
      day: string;
      day_remaining_seconds: number;
      cards: FamilyStartCardResponse[];
    }) => void;
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    narrowNextFamilyRead(family, "1");
    const first = readParentFamily(family);
    read.mockResolvedValueOnce({
      ...serverDay,
      cards: [card("1", "v2", false)],
    });
    narrowNextFamilyRead(family, "1");
    const second = readParentFamily(family);
    expect((await second).features["1"]?.notes_enabled).toBe(false);
    finish({ ...serverDay, cards: [card("1")] });
    await first;
  });
});
