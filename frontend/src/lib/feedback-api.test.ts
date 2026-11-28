import { ApiError } from "./api-error";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchStudentFeedback } from "./feedback-api";
import { plainFetch } from "~/test/mocks/plain-session-fetch";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const mockAnswer = vi.fn();

describe("fetchStudentFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(plainFetch(mockAnswer)));
  });

  it("fetches and maps feedback entries correctly", async () => {
    const backendEntries = [
      {
        id: "10",
        value: "positive",
        day: "2026-04-01",
        time: "15:30:23",
        student_id: "1",
        is_mensa_feedback: false,
        created_at: "2026-04-01T15:30:23Z",
        updated_at: "2026-04-01T15:30:23Z",
      },
      {
        id: "11",
        value: "negative",
        day: "2026-04-02",
        time: "14:10:05",
        student_id: "1",
        is_mensa_feedback: true,
        created_at: "2026-04-02T14:10:05Z",
        updated_at: "2026-04-02T14:10:05Z",
      },
    ];

    mockAnswer.mockResolvedValue({
      ok: true,
      json: async () => ({ data: backendEntries }),
    });

    const result = await fetchStudentFeedback("1");

    expect(fetch).toHaveBeenCalledWith("/api/feedback/student/1", {
      method: "GET",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "10",
      day: "2026-04-01",
      time: "15:30:23",
      feedbackType: "positive",
      isMensaFeedback: false,
    });
    expect(result[1]).toEqual({
      id: "11",
      day: "2026-04-02",
      time: "14:10:05",
      feedbackType: "negative",
      isMensaFeedback: true,
    });
  });

  it("returns empty array on 404", async () => {
    mockAnswer.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const result = await fetchStudentFeedback("999");

    expect(result).toEqual([]);
  });

  it("carries the feedback.disabled code of a switched-off feature", async () => {
    mockAnswer.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 403,
          detail: "feature_disabled",
          code: "feedback.disabled",
        }),
        { status: 403, statusText: "Forbidden" },
      ),
    );

    const error = await fetchStudentFeedback("1").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe("feedback.disabled");
  });

  it("uses the permission class code for a 403 without a body", async () => {
    mockAnswer.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    const error = await fetchStudentFeedback("1").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe("general.permission");
  });

  it("throws on non-404 error", async () => {
    mockAnswer.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchStudentFeedback("1")).rejects.toMatchObject({
      status: 500,
    });
  });

  it("handles empty data array", async () => {
    mockAnswer.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const result = await fetchStudentFeedback("1");
    expect(result).toEqual([]);
  });

  it("throws and logs on network error", async () => {
    mockAnswer.mockRejectedValue(new Error("Network error"));

    await expect(fetchStudentFeedback("1")).rejects.toThrow("Network error");
  });
});
