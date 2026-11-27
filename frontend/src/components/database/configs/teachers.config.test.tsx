import { afterEach, describe, expect, it, vi } from "vitest";
import { teachersConfig } from "./teachers.config";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

describe("teachersConfig", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The list answers staff records of the contract (#7563);
  // the person is nested and ids are decimal strings.
  it("maps the nested person of a contract record including avatar and account id", async () => {
    const record = {
      started_on: "2024-09-02",
      ended_on: null,
      id: "42",
      person_id: "7",
      account_role: "admin",
      specialization: "Mathematik",
      is_teacher: true,
      was_present_today: false,
      is_external: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      person: {
        id: "7",
        account_id: "55",
        email: "nested@example.com",
        first_name: "Nora",
        last_name: "Nested",
        avatar: "/uploads/avatars/global/nora.jpg",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ data: [record] }))),
    );

    const [mapped] = await teachersConfig.api.list();

    expect(mapped).toMatchObject({
      id: "42",
      name: "Nora Nested",
      first_name: "Nora",
      last_name: "Nested",
      email: "nested@example.com",
      avatar: "/uploads/avatars/global/nora.jpg",
      account_role: "admin",
      account_id: "55",
      person_id: "7",
    });
  });
});
