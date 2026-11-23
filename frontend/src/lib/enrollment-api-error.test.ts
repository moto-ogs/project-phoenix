import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import { logEnrollmentFailure } from "./enrollment-api-error";

function refusal(status: number): ApiError {
  return new ApiError("Phase konnte nicht gespeichert werden", status, {
    code: status >= 500 ? "general.server" : "students.child_quota_reached",
    detail: "weird backend error",
    instance: "req-123",
  });
}

describe("logEnrollmentFailure", () => {
  it("rethrows the ApiError unchanged for the shared error path", () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const error = refusal(409);

    expect(() => logEnrollmentFailure(error, logger, "test_event")).toThrow(
      error,
    );
    expect(error.message).not.toContain("weird backend error");
  });

  it("logs the backend sentence as diagnosis, a refusal as a warning", () => {
    const logger = { error: vi.fn(), warn: vi.fn() };

    expect(() =>
      logEnrollmentFailure(refusal(409), logger, "test_event"),
    ).toThrow();

    expect(logger.warn).toHaveBeenCalledWith("test_event", {
      status: 409,
      code: "students.child_quota_reached",
      requestId: "req-123",
      rawMessage: "weird backend error",
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs a server error as an error", () => {
    const logger = { error: vi.fn(), warn: vi.fn() };

    expect(() =>
      logEnrollmentFailure(refusal(500), logger, "test_event"),
    ).toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      "test_event",
      expect.objectContaining({ status: 500, code: "general.server" }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs as an error when the logger has no warning level", () => {
    const logger = { error: vi.fn() };

    expect(() =>
      logEnrollmentFailure(refusal(409), logger, "test_event"),
    ).toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      "test_event",
      expect.objectContaining({ status: 409 }),
    );
  });

  it("passes a failure without a status on without logging it", () => {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const abort = new DOMException("aborted", "AbortError");

    expect(() => logEnrollmentFailure(abort, logger, "test_event")).toThrow(
      abort,
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
