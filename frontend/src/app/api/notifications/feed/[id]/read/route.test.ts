import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiPost } = vi.hoisted(() => ({
  mockApiPost: vi.fn(),
}));

vi.mock("~/lib/api-helpers.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/api-helpers.server")>()),
  apiPost: mockApiPost,
}));
vi.mock("~/lib/route-wrapper.server", () => ({
  createPostHandler: (handler: Function) => handler,
}));

const { POST } = await import("./route");

describe("/api/notifications/feed/[id]/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks one entry read and answers the new unread count", async () => {
    mockApiPost.mockResolvedValue({ data: { unread_count: 3 } });

    const result = await (POST as Function)({}, {}, "test-token", { id: "42" });

    expect(mockApiPost).toHaveBeenCalledWith(
      "/api/notifications/feed/42/read",
      "test-token",
    );
    expect(result).toEqual({ unread_count: 3 });
  });

  it.each(["abc", "4/2", "../read-all", ""])(
    "refuses the id %j before the backend sees it",
    async (id) => {
      await expect(
        (POST as Function)({}, {}, "test-token", { id }),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockApiPost).not.toHaveBeenCalled();
    },
  );
});
