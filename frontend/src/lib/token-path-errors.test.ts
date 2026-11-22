// A link token in a path is a credential. A refused request must not carry
// it in the ApiError message, which reaches logs and error reports.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptCatererInvitation, fetchCatererInvitation } from "./caterer-api";
import {
  fetchFamilyChildren,
  stateFamilyChildren,
} from "./parent-family-children-api";

const TOKEN = "secret-token";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () =>
    Response.json({ code: "identity.invalid_credentials" }, { status: 401 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("token paths keep the token out of error messages", () => {
  it.each([
    ["caterer invitation", () => fetchCatererInvitation("4", TOKEN)],
    [
      "caterer acceptance",
      () => acceptCatererInvitation("4", TOKEN, "pw", "pw"),
    ],
    [
      "family children by signing link",
      () => fetchFamilyChildren({ kind: "link", link: TOKEN }),
    ],
    [
      "family children by status token",
      () => stateFamilyChildren({ kind: "enrollment", token: TOKEN }, 2),
    ],
  ])("%s", async (_, request) => {
    const error: unknown = await request().catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 401,
      code: "identity.invalid_credentials",
    });
    expect(String((error as Error).message)).not.toContain(TOKEN);
  });
});
