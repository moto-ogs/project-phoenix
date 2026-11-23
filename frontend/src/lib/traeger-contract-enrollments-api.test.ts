import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewContractEnrollments,
  runContractEnrollments,
  unbindContractEnrollment,
} from "./traeger-contract-enrollments-api";

const bff = vi.hoisted(() => ({ bffJson: vi.fn() }));
vi.mock("~/lib/bff-fetch", () => bff);

const WIRE_ROW = {
  contract_id: "82",
  school_id: "2",
  status: "held",
  reason: "a_reason_of_a_later_build",
  contract_child: { first_name: "Jonas", last_name: "Zimmermann" },
  student: { student_id: "12", first_name: "Jonas", last_name: "Zimmermann" },
  phase_name: "Schuljahr",
  bookings: [
    {
      care_offering_id: "7",
      module_name: "Betreuung bis 15 Uhr",
      days: ["mon", "funday"],
      valid_from: "2026-09-01",
      valid_until: null,
      end_times: { mon: "15:00", funday: "9:00" },
      available_days: null,
      days_of_week_mode: "parent_choice",
    },
  ],
  changes: null,
};

describe("traeger-contract-enrollments-api", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("maps a preview and keeps unknown values unknown", async () => {
    bff.bffJson.mockResolvedValueOnce({
      school_id: "2",
      fingerprint: "fp",
      counts: { ready: 0, done: 0, unlinked: 0, held: 1, stuck: 0, changed: 0 },
      rows: [
        WIRE_ROW,
        { ...WIRE_ROW, status: "later", reason: "", student: undefined },
      ],
    });
    const preview = await previewContractEnrollments("2");
    expect(bff.bffJson).toHaveBeenCalledWith(
      "org",
      "POST /traeger/contract-enrollments/preview",
      { body: { school_id: "2" } },
    );
    const [first, second] = preview.rows;
    expect(first?.status).toBe("held");
    expect(first?.reason).toBeUndefined();
    expect(first?.student).toEqual({
      studentId: "12",
      firstName: "Jonas",
      lastName: "Zimmermann",
      birthDate: null,
    });
    expect(first?.bookings[0]?.days).toEqual(["mon"]);
    expect(first?.bookings[0]?.endTimes).toEqual({ mon: "15:00" });
    expect(first?.changes).toEqual([]);
    expect(second?.status).toBeUndefined();
    expect(second?.student).toBeNull();
  });

  it("runs with the fingerprint and unbinds the enrollment the office saw", async () => {
    bff.bffJson.mockResolvedValueOnce({
      school_id: "2",
      changed: true,
      counts: { ready: 0, done: 1, unlinked: 0, held: 0, stuck: 0, changed: 0 },
      rows: null,
    });
    const run = await runContractEnrollments("2", "fp");
    expect(run).toMatchObject({ changed: true, rows: [] });
    expect(bff.bffJson).toHaveBeenLastCalledWith(
      "org",
      "POST /traeger/contract-enrollments/",
      { body: { school_id: "2", fingerprint: "fp" } },
    );
    bff.bffJson.mockResolvedValueOnce(undefined);
    await unbindContractEnrollment("79", "128");
    expect(bff.bffJson).toHaveBeenLastCalledWith(
      "org",
      "DELETE /traeger/contract-enrollments/{contractId}",
      { params: { contractId: "79" }, query: { request_child_id: "128" } },
    );
  });
});
