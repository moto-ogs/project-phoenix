import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, handleAuthFailure } = vi.hoisted(() => ({
  getSession: vi.fn(),
  handleAuthFailure: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ getSession }));
vi.mock("./auth-failure", () => ({ handleAuthFailure }));

import { timetableService } from "./timetable-api";
import { timetableOperationsApi } from "./timetable-operations-api";

describe.each([
  ["planner", () => timetableService.getStaffPool("42"), { entries: [] }],
  ["operations", () => timetableOperationsApi.plannedNow(), { instances: [] }],
] as const)("%s session handling", (_name, call, data) => {
  beforeEach(() => {
    getSession.mockResolvedValue({ user: { id: "1" }, expires: "2099-01-01" });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renews a refused session and retries the original request", async () => {
    const fetch = vi.mocked(globalThis.fetch);
    fetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data }));
    handleAuthFailure.mockResolvedValueOnce(true);

    await call();

    expect(handleAuthFailure).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[0]);
  });

  it("delegates an unrecoverable session to the shared failure handler", async () => {
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    handleAuthFailure.mockResolvedValueOnce(false);

    await expect(call()).rejects.toMatchObject({
      status: 401,
      code: "general.permission",
    });

    expect(handleAuthFailure).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
