import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));
const tenantHostname = "demo.localhost:3000";

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    auth: mockAuth,
  }),
);

vi.mock("~/lib/server-api-url", () => ({
  getServerApiUrl: () => "http://backend.test",
}));

const { GET } = await import("./route");

function getRequest({
  query = "",
  originalHost = tenantHostname,
}: {
  query?: string;
  originalHost?: string;
} = {}): NextRequest {
  return new NextRequest(
    new URL(
      `http://next-internal:3000/api/enrollment/form-bootstrap/public/demo/5${query}`,
    ),
    {
      headers: {
        host: "next-internal:3000",
        "x-moto-original-host": originalHost,
      },
    },
  );
}

const payload = {
  status: "success",
  data: {
    phase: {
      id: "5",
      name: "Schuljahr",
      kind: "year",
      service_start_date: "2027-08-01",
      service_end_date: "2028-07-31",
      show_status_reason_to_parent: false,
      care_offering_selection_mode: "none",
      audience: "public",
      eligible_grade_levels: null,
    },
    schema: null,
    offerings: [],
    care_offering_selection_mode: "none",
    care_required: false,
    school_class: {
      collect: false,
      available_classes: null,
      require: false,
      collect_grade_1: false,
    },
    collect_grade_level: false,
    care_offerings_enabled: false,
    captcha_config: { enabled: false, site_key: "" },
    legal_texts: {
      agb: "",
      agb_document_url: "",
      agb_display_mode: "text",
      dsgvo: "",
      email_contact: "",
      photo: "",
      terms_enabled: false,
      dsgvo_enabled: false,
      email_contact_enabled: false,
      photo_enabled: false,
      blocks: [],
    },
  },
} as const;

describe("GET /api/enrollment/form-bootstrap/public/[tenantSlug]/[phaseId]", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockAuth.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns anonymous bootstrap payload when optional auth enrichment fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    mockAuth.mockRejectedValueOnce(new Error("session backend unavailable"));

    const response = await GET(getRequest(), {
      params: Promise.resolve({ tenantSlug: "demo", phaseId: "5" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps tenant-session profile enrichment for the tenant public form", async () => {
    const profile = {
      guardian: {
        first_name: "Tina",
        last_name: "Tenant",
        email: "tina@example.test",
      },
      children: [],
    };
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "success", data: profile }), {
          status: 200,
        }),
      );
    mockAuth.mockResolvedValueOnce({ user: { token: "tenant-token" } });

    const response = await GET(getRequest(), {
      params: Promise.resolve({ tenantSlug: "demo", phaseId: "5" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ...payload,
      data: { ...payload.data, profile },
    });
    expect(mockAuth).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://backend.test/api/enrollment/me/profile",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tenant-token",
        }),
      }),
    );
  });

  it("ignores the legacy profile query flag on a tenant host", async () => {
    const profile = {
      guardian: {
        first_name: "Tina",
        last_name: "Tenant",
        email: "tina@example.test",
      },
      children: [],
    };
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "success", data: profile }), {
          status: 200,
        }),
      );
    mockAuth.mockResolvedValueOnce({ user: { token: "tenant-token" } });

    const response = await GET(getRequest({ query: "?prefetch_profile=0" }), {
      params: Promise.resolve({ tenantSlug: "demo", phaseId: "5" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ...payload,
      data: { ...payload.data, profile },
    });
    expect(mockAuth).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
