import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendTestNotification } from "./notification-api";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

describe("sendTestNotification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to the tenant proxy", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ status: "success", data: null }));

    await sendTestNotification();

    expect(fetchMock).toHaveBeenCalledWith("/api/notifications/test", {
      method: "POST",
    });
  });

  it("posts to the school proxy for moto schule", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await sendTestNotification("school");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/school/notifications/test",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  // #2517: the card shows the catalog text for the code, so the client keeps
  // the backend code instead of choosing a sentence by status.
  it("keeps the code when the school has disabled notifications", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { code: "communication.notifications_disabled" },
        { status: 409 },
      ),
    );

    await expect(sendTestNotification()).rejects.toMatchObject({
      status: 409,
      code: "communication.notifications_disabled",
    });
  });

  it("classifies other failures by status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await expect(sendTestNotification()).rejects.toMatchObject({
      status: 500,
      code: "general.server",
    });
  });

  it("reports a request that cannot be sent as unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    await expect(sendTestNotification()).rejects.toMatchObject({
      code: "general.unavailable",
    });
  });
});
