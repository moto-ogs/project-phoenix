import { afterEach, describe, expect, it, vi } from "vitest";
import { emailCodeFactorApi } from "./email-code-factor-api";

describe("emailCodeFactorApi", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("reads the parent's state and start in the catalog proxy's envelope (#2352)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          status: "success",
          data: { enabled: false, available: false, masked_email: "e***@x.de" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "success",
          data: { challenge_token: "wrapped", masked_email: "e***@x.de" },
        }),
      );
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const api = emailCodeFactorApi("parent");

    await expect(api.status()).resolves.toEqual({
      enabled: false,
      available: false,
      maskedEmail: "e***@x.de",
    });
    await expect(api.start()).resolves.toEqual({
      challengeToken: "wrapped",
      maskedEmail: "e***@x.de",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/parent/me/mfa",
      "/api/parent/me/mfa/start",
    ]);
  });

  it("reads the caterer's factor as always available", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      Response.json({
        status: "success",
        data: { enabled: true, masked_email: "e***@x.de" },
      }),
    ) as unknown as typeof global.fetch;

    await expect(emailCodeFactorApi("caterer").status()).resolves.toEqual({
      enabled: true,
      available: true,
      maskedEmail: "e***@x.de",
    });
  });

  it("switches the factor off with the backend's field name (#2352)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "success", data: null }));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await emailCodeFactorApi("caterer").disable("Passw0rd!");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/caterer/account/mfa/disable");
    expect(JSON.parse(init.body as string)).toEqual({
      current_password: "Passw0rd!",
    });
  });
});
