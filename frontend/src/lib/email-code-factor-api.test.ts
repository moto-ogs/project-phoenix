import { afterEach, describe, expect, it, vi } from "vitest";
import { emailCodeFactorApi } from "./email-code-factor-api";

describe("emailCodeFactorApi", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("reads the state and the start bare and in the catalog proxy's envelope (#2352)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          enabled: false,
          available: false,
          masked_email: "e***@x.de",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          message: "Success",
          data: { enabled: true, masked_email: "e***@x.de" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ challenge_token: "bare" }))
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          message: "Success",
          data: { challenge_token: "wrapped", masked_email: "e***@x.de" },
        }),
      );
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const api = emailCodeFactorApi("/api/parent/me/mfa");

    await expect(api.status()).resolves.toEqual({
      enabled: false,
      available: false,
      maskedEmail: "e***@x.de",
    });
    // The caterer's state names no availability: its factor is always available.
    await expect(api.status()).resolves.toEqual({
      enabled: true,
      available: true,
      maskedEmail: "e***@x.de",
    });
    await expect(api.start()).resolves.toEqual({
      challengeToken: "bare",
      maskedEmail: "",
    });
    await expect(api.start()).resolves.toEqual({
      challengeToken: "wrapped",
      maskedEmail: "e***@x.de",
    });
  });
});
