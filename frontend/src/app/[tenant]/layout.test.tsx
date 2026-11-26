import type { ReactElement } from "react";
import { fireEvent, render as renderUi, screen } from "@testing-library/react";
import type { PortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { deferred } from "~/test/helpers/form-modal-pending";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, notFoundMock, readPortalSessionSnapshotMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(async () => null),
    readPortalSessionSnapshotMock: vi.fn<
      () => Promise<PortalSessionSnapshot | null>
    >(async () => null),
    notFoundMock: vi.fn((): never => {
      throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
    }),
  }),
);

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: vi.fn(),
}));

const { headersMock } = vi.hoisted(() => ({
  headersMock: vi.fn(
    async () => new Headers({ host: "school-a.localhost:3000" }),
  ),
}));
vi.mock("next/headers", () => ({
  headers: headersMock,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => undefined,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    auth: authMock,
  }),
);
vi.mock("~/server/auth/operator", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("operator", {
    auth: async () => ({ user: { token: "operator-token" } }),
  }),
);

vi.mock("~/lib/shell-bootstrap.server", () => ({
  loadShellBootstrap: vi.fn(),
}));

vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readRenderedSessionMark: async () => "",
  readPortalSessionSnapshot: readPortalSessionSnapshotMock,
}));

vi.mock("~/env", () => ({
  env: {
    API_URL: "http://server:8080",
    NODE_ENV: "development",
    TENANT_DOMAIN: "localhost",
  },
}));

const { bareTenantHost, default: TenantLayout } = await import("./layout");
const {
  invalidateTenantResolve,
  resolveTenantCached,
  TenantResolveStatusError,
} = await import("~/lib/tenant-resolve.server");
const { setTestClock, TEST_CLOCK_INSTANT } = await import("~/test/clock");
const navigation = await import("next/navigation");

beforeEach(() => {
  authMock.mockClear();
  readPortalSessionSnapshotMock.mockReset();
  readPortalSessionSnapshotMock.mockResolvedValue(null);
  notFoundMock.mockClear();
  headersMock.mockClear();
  headersMock.mockImplementation(
    async () => new Headers({ host: "school-a.localhost:3000" }),
  );
  invalidateTenantResolve("school-a");
  vi.restoreAllMocks();
});

const tenantDefaults = {
  hidden: false,
  presence_mode: "",
  student_photos_enabled: false,
  booked_modules: null,
  parent_messaging_enabled: false,
  parent_message_card_badge_enabled: false,
  staff_messaging_enabled: false,
  display_enabled: false,
  caldav_enabled: false,
  care_offerings_enabled: false,
  attendance_web_enabled: false,
  attendance_log_enabled: false,
  group_mode: "",
  operational_overview_scope: "",
  attendance_edit_scope: "",
  parent_request_reason_policy: "both",
  show_timetable_counts: false,
  timetable_enabled: true,
  meal_plan_enabled: false,
  meal_registration_enabled: false,
  waitlist_enabled: false,
  analytics_enabled: false,
  analytics_freigabe: false,
  analytics_recording_sample_percent: 0,
  early_checkout_note_enabled: false,
  early_checkout_note_tolerance_minutes: 0,
  weekend_follows_friday: false,
  children_without_care_place: false,
  child_search_only_navigation: false,
  simple_staff_navigation: false,
  care_facility_term: "",
};

function tenantResponse(name = "School A") {
  return new Response(
    JSON.stringify({
      status: "success",
      data: {
        ...tenantDefaults,
        tenant_id: "1",
        slug: "school-a",
        name,
        subdomain: "school-a",
        organization_id: "2",
        organization_name: "Organization",
        settings: {},
        grade_level_max: 4,
      },
    }),
    { status: 200 },
  );
}

function visitorHeaders(ip: string) {
  return new Headers({
    host: "school-a.localhost:3000",
    "user-agent": "Browser/1",
    "x-forwarded-for": ip,
  });
}

describe("bareTenantHost", () => {
  it("strips an invalid local tenant subdomain and keeps the port", () => {
    expect(bareTenantHost("asld.localhost:3000")).toBe("localhost:3000");
  });

  it("keeps the bare tenant domain unchanged", () => {
    expect(bareTenantHost("localhost:3000")).toBe("localhost:3000");
  });
});

describe("TenantLayout", () => {
  it.each(["wp-trackback.php", "__status", "School-a", "a".repeat(64)])(
    "returns 404 for invalid tenant path %s without resolving it",
    async (tenant) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        TenantLayout({ children: null, params: Promise.resolve({ tenant }) }),
      ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");

      expect(notFoundMock).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for a reserved tenant path without resolving it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "operator" }),
      }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");

    expect(notFoundMock).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // #5130: path mode on the bare domain shares the session cookie with
  // every school but names none in its host. The page moves to the
  // school's subdomain with its path and query.
  describe("path mode on the bare domain", () => {
    const redirect = vi.mocked(navigation.redirect);

    function requestTo(host: string, originalPath?: string) {
      headersMock.mockImplementation(
        async () =>
          new Headers({
            host: "frontend:3000",
            "x-moto-original-host": host,
            "x-moto-original-proto": "https",
            ...(originalPath && { "x-moto-original-path": originalPath }),
          }),
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        tenantResponse(),
      );
    }

    beforeEach(() => redirect.mockClear());

    it.each([
      [
        "an enrollment link",
        "/school-a/anmeldung/phase-1?late_invite=x",
        "/anmeldung/phase-1?late_invite=x",
      ],
      ["a display link", "/school-a/display", "/display"],
      ["the start page with a query", "/school-a?from=letter", "/?from=letter"],
      ["the start page", "/school-a", "/"],
      ["a request without the proxy's path", undefined, "/"],
    ])(
      "sends %s to the school's subdomain",
      async (_case, originalPath, target) => {
        requestTo("localhost:3000", originalPath);

        const result = await TenantLayout({
          children: null,
          params: Promise.resolve({ tenant: "school-a" }),
        });

        expect(result).toMatchObject({
          props: { href: `https://school-a.localhost:3000${target}` },
        });
        // Nothing of the school loads on the bare domain.
        expect(readPortalSessionSnapshotMock).not.toHaveBeenCalled();
      },
    );

    it("sends a mixed-case bare host with a trailing dot as well", async () => {
      requestTo("LOCALHOST.:3000", "/school-a/display");

      const result = await TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "school-a" }),
      });

      expect(result).toMatchObject({
        props: { href: "https://school-a.localhost:3000/display" },
      });
    });

    it.each(["school-a.localhost:3000", "frontend-preview.example.org"])(
      "keeps %s, which is no bare tenant domain",
      async (host) => {
        requestTo(host, "/students");

        const result = await TenantLayout({
          children: null,
          params: Promise.resolve({ tenant: "school-a" }),
        });

        // Anker: die Schule lädt ihre Sitzung und ihr Gerüst.
        expect(readPortalSessionSnapshotMock).toHaveBeenCalledOnce();
        expect(result).not.toMatchObject({
          props: { href: expect.anything() },
        });
        expect(redirect).not.toHaveBeenCalled();
      },
    );
  });

  it("still resolves a syntactically valid tenant path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            ...tenantDefaults,
            tenant_id: "1",
            slug: "school-a",
            name: "School A",
            subdomain: "school-a",
            organization_id: "2",
            organization_name: "Organization",
            settings: {},
            grade_level_max: 4,
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "school-a" }),
      }),
    ).resolves.toBeTruthy();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://server:8080/auth/tenant/resolve?slug=school-a",
      expect.objectContaining({ headers: {}, cache: "no-store" }),
    );
  });

  it("does not cache a successful HTTP response without tenant data", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ status: "success" }))
      .mockResolvedValueOnce(tenantResponse());

    await expect(resolveTenantCached("school-a", {})).rejects.toMatchObject({
      status: 502,
    });
    expect((await resolveTenantCached("school-a", {})).name).toBe("School A");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries a transient server failure on the next lookup", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(tenantResponse());

    await expect(resolveTenantCached("school-a", {})).rejects.toMatchObject({
      status: 500,
    });
    expect((await resolveTenantCached("school-a", {})).name).toBe("School A");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rechecks a missing slug immediately after invalidation", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(tenantResponse());

    await expect(resolveTenantCached("school-a", {})).rejects.toMatchObject({
      status: 404,
    });
    await expect(resolveTenantCached("school-a", {})).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();

    invalidateTenantResolve("school-a");
    expect((await resolveTenantCached("school-a", {})).name).toBe("School A");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps cached schools even when a lookup starts at the hit limit", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => tenantResponse());
    await resolveTenantCached("school-a", {});
    const slugs = Array.from(
      { length: 999 },
      (_, index) => `cached-school-${index}`,
    );
    for (const slug of slugs) await resolveTenantCached(slug, {});
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      resolveTenantCached("scanner-probe-at-limit", {}),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect((await resolveTenantCached("school-a", {})).name).toBe("School A");
    expect(fetchSpy).toHaveBeenCalledTimes(1001);
    for (const slug of slugs) invalidateTenantResolve(slug);
    invalidateTenantResolve("scanner-probe-at-limit");
  });

  it("ignores invalid branding fields without losing valid settings or the school", async () => {
    const valid = await tenantResponse().json();
    const settings = {
      loginImageUrl: "/image.webp",
      schoolValue: { enabled: true },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        ...valid,
        data: { ...valid.data, settings: { ...settings, logoUrl: 123 } },
      }),
    );

    const tenant = await resolveTenantCached("school-a", {});
    expect(tenant.name).toBe("School A");
    expect(tenant.settings).toEqual(settings);
    expect(tenant.settings?.logoUrl).toBeUndefined();
    expect(await resolveTenantCached("school-a", {})).toBe(tenant);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("shares a refresh and waits for current tenant settings after 60 seconds", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tenantResponse())
      .mockResolvedValueOnce(tenantResponse("Updated school"));

    expect((await resolveTenantCached("school-a", {})).name).toBe("School A");
    setTestClock(new Date(TEST_CLOCK_INSTANT.getTime() + 60_000));
    const results = await Promise.all([
      resolveTenantCached("school-a", {}),
      resolveTenantCached("school-a", {}),
    ]);
    expect(results.map((result) => result.name)).toEqual([
      "Updated school",
      "Updated school",
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps fresh settings when a lookup started before invalidation finishes later", async () => {
    const earlier = deferred<Response>();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce(tenantResponse("Updated school"));

    const old = resolveTenantCached("school-a", {});
    invalidateTenantResolve("school-a");
    expect((await resolveTenantCached("school-a", {})).name).toBe(
      "Updated school",
    );
    earlier.resolve(tenantResponse());
    expect((await old).name).toBe("School A");
    expect((await resolveTenantCached("school-a", {})).name).toBe(
      "Updated school",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([404, 429])(
    "preserves HTTP %s across bundles sharing a lookup",
    async (status) => {
      vi.resetModules();
      const other = await import("~/lib/tenant-resolve.server");
      expect(other.TenantResolveStatusError).not.toBe(TenantResolveStatusError);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, {
          status,
          headers: status === 429 ? { "Retry-After": "7" } : undefined,
        }),
      );

      const first = resolveTenantCached("school-a", {});
      const second = other.resolveTenantCached("school-a", {});
      await Promise.all([
        expect(first).rejects.toBeInstanceOf(TenantResolveStatusError),
        expect(second).rejects.toBeInstanceOf(other.TenantResolveStatusError),
        expect(second).rejects.toMatchObject({
          status,
          retryAfter: status === 429 ? "7" : null,
        }),
      ]);
      expect(fetchSpy).toHaveBeenCalledOnce();
    },
  );

  // #4803: the switch hides the single class list entry and the OGS areas
  // of a child; a mapping without it left the switch off in every page.
  it("hands the switch for children without an OGS place to the pages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            ...tenantDefaults,
            tenant_id: "1",
            slug: "school-a",
            name: "School A",
            subdomain: "school-a",
            organization_id: "2",
            organization_name: "Organization",
            settings: {},
            grade_level_max: 4,
            children_without_care_place: true,
          },
        }),
        { status: 200 },
      ),
    );

    const element = (await TenantLayout({
      children: null,
      params: Promise.resolve({ tenant: "school-a" }),
    })) as ReactElement<{ tenant: { childrenWithoutCarePlace?: boolean } }>;

    expect(element.props.tenant.childrenWithoutCarePlace).toBe(true);
  });

  it("charges a cache miss to the visitor's IP", async () => {
    // Without the header the backend rate-limits the frontend container,
    // and all visitors share one bucket.
    headersMock.mockImplementation(async () => visitorHeaders("203.0.113.5"));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(tenantResponse());

    await TenantLayout({
      children: null,
      params: Promise.resolve({ tenant: "school-a" }),
    });

    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      "http://server:8080/auth/tenant/resolve?slug=school-a",
      expect.objectContaining({
        headers: {
          "X-Forwarded-For": "203.0.113.5",
          "User-Agent": "Browser/1",
        },
        cache: "no-store",
      }),
    );
  });

  it("shares the cached lookup across visitors instead of keying it by IP", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => tenantResponse());
    const render = async (ip: string) => {
      headersMock.mockImplementation(async () => visitorHeaders(ip));
      return TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "school-a" }),
      });
    };

    await expect(render("203.0.113.5")).resolves.toBeTruthy();
    await expect(render("198.51.100.9")).resolves.toBeTruthy();

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("asks the backend about an unknown tenant only once per minute", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 404 }));
    const renderUnknown = () =>
      TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "scanner-probe" }),
      });

    await expect(renderUnknown()).rejects.toThrow(
      "Tenant redirect did not complete",
    );
    await expect(renderUnknown()).rejects.toThrow(
      "Tenant redirect did not complete",
    );
    expect(fetchSpy).toHaveBeenCalledOnce();

    setTestClock(new Date(TEST_CLOCK_INSTANT.getTime() + 61_000));
    await expect(renderUnknown()).rejects.toThrow(
      "Tenant redirect did not complete",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("shows a waiting page with a full reload when the lookup is rate limited", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 429 }));
    const reloadSpy = vi
      .spyOn(globalThis.location, "reload")
      .mockImplementation(() => undefined);

    const page = await TenantLayout({
      children: <p>Schulinhalt</p>,
      params: Promise.resolve({ tenant: "school-busy" }),
    });
    renderUi(page);

    // Anker: die Warteseite ist gerendert, nicht der Schulinhalt.
    expect(
      screen.getByRole("heading", { name: "Bitte kurz warten" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Die Seite lädt gerade nicht. Das liegt nicht an dir. Bitte warte eine Minute. Lade die Seite dann neu.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Schulinhalt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Neu laden" }));
    expect(reloadSpy).toHaveBeenCalledOnce();

    // The rejection is not cached: the next load asks the backend again.
    await TenantLayout({
      children: null,
      params: Promise.resolve({ tenant: "school-busy" }),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps other lookup failures on the error path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 503 }),
    );

    await expect(
      TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "school-busy" }),
      }),
    ).rejects.toThrow("Tenant resolution failed with HTTP 503");
  });

  it("does not run refresh-capable auth callbacks from the server layout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            ...tenantDefaults,
            tenant_id: "1",
            slug: "school-a",
            name: "School A",
            subdomain: "school-a",
            organization_id: "2",
            organization_name: "Organization",
            settings: {},
            grade_level_max: 4,
          },
        }),
        { status: 200 },
      ),
    );

    await TenantLayout({
      children: null,
      params: Promise.resolve({ tenant: "school-a" }),
    });

    expect(authMock).not.toHaveBeenCalled();
  });

  // The provider prop lands in the HTML and RSC payload; only the server
  // side shell preload receives the access token (#5005).
  it("passes the read-only session snapshot to the client provider", async () => {
    const session = {
      expires: "2026-09-04T12:00:00.000Z",
      user: { id: "7", tenantId: "1" },
    };
    readPortalSessionSnapshotMock.mockResolvedValue({
      session,
      accessToken: "backend-access",
      notBooked: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            ...tenantDefaults,
            tenant_id: "1",
            slug: "school-a",
            name: "School A",
            subdomain: "school-a",
            organization_id: "2",
            organization_name: "Organization",
            settings: {},
            grade_level_max: 4,
          },
        }),
        { status: 200 },
      ),
    );

    const element = (await TenantLayout({
      children: null,
      params: Promise.resolve({ tenant: "school-a" }),
    })) as ReactElement<{ session: unknown }>;

    expect(element.props.session).toBe(session);
    expect(JSON.stringify(element.props)).not.toContain("backend-access");
    const { loadShellBootstrap } = await import("~/lib/shell-bootstrap.server");
    expect(loadShellBootstrap).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ tenantId: "1" }),
      "backend-access",
    );
  });

  it.each([
    { timetable_enabled: false, expected: false },
    { timetable_enabled: true, expected: true },
    { timetable_enabled: undefined, expected: true },
  ])(
    "maps timetable_enabled=$timetable_enabled into the server tenant context",
    async ({ timetable_enabled, expected }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              ...tenantDefaults,
              tenant_id: "1",
              slug: "school-a",
              name: "School A",
              subdomain: "school-a",
              organization_id: "2",
              organization_name: "Organization",
              settings: {},
              grade_level_max: 4,
              timetable_enabled:
                timetable_enabled ?? tenantDefaults.timetable_enabled,
            },
          }),
          { status: 200 },
        ),
      );

      const element = (await TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "school-a" }),
      })) as ReactElement<{ tenant: { timetableEnabled?: boolean } }>;

      expect(element.props.tenant.timetableEnabled).toBe(expected);
    },
  );

  // #5024: the first render of „Anfragen“ reads the reason policy from the
  // server tenant context. Without it the strictest fallback asked for a
  // reason on every approval, whatever the school had chosen.
  it.each([
    { parent_request_reason_policy: "guardians", expected: "guardians" },
    { parent_request_reason_policy: "nobody", expected: "nobody" },
    { parent_request_reason_policy: "staff", expected: "staff" },
    { parent_request_reason_policy: "both", expected: "both" },
    { parent_request_reason_policy: "irgendwas", expected: "both" },
    { parent_request_reason_policy: undefined, expected: "both" },
  ])(
    "maps parent_request_reason_policy=$parent_request_reason_policy into the server tenant context",
    async ({ parent_request_reason_policy, expected }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              ...tenantDefaults,
              tenant_id: "1",
              slug: "school-a",
              name: "School A",
              subdomain: "school-a",
              organization_id: "2",
              organization_name: "Organization",
              settings: {},
              grade_level_max: 4,
              parent_request_reason_policy:
                parent_request_reason_policy ??
                tenantDefaults.parent_request_reason_policy,
            },
          }),
          { status: 200 },
        ),
      );

      const element = (await TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "school-a" }),
      })) as ReactElement<{
        tenant: { parentRequestReasonPolicy?: string };
      }>;

      expect(element.props.tenant.parentRequestReasonPolicy).toBe(expected);
    },
  );

  it.each([
    { analytics_enabled: false, expected: false },
    { analytics_enabled: true, expected: true },
    { analytics_enabled: undefined, expected: false },
  ])(
    "maps analytics_enabled=$analytics_enabled into the server tenant context",
    async ({ analytics_enabled, expected }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              ...tenantDefaults,
              tenant_id: "1",
              slug: "school-a",
              name: "School A",
              subdomain: "school-a",
              organization_id: "2",
              organization_name: "Organization",
              settings: {},
              grade_level_max: 4,
              analytics_enabled:
                analytics_enabled ?? tenantDefaults.analytics_enabled,
            },
          }),
          { status: 200 },
        ),
      );

      const element = (await TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "school-a" }),
      })) as ReactElement<{ tenant: { analyticsEnabled?: boolean } }>;

      expect(element.props.tenant.analyticsEnabled).toBe(expected);
    },
  );
  it.each([
    { caldav_enabled: false, expected: false },
    { caldav_enabled: true, expected: true },
    { caldav_enabled: undefined, expected: false },
  ])(
    "maps caldav_enabled=$caldav_enabled into the server tenant context",
    async ({ caldav_enabled, expected }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              ...tenantDefaults,
              tenant_id: "1",
              slug: "school-a",
              name: "School A",
              subdomain: "school-a",
              organization_id: "2",
              organization_name: "Organization",
              settings: {},
              grade_level_max: 4,
              caldav_enabled: caldav_enabled ?? tenantDefaults.caldav_enabled,
            },
          }),
          { status: 200 },
        ),
      );

      const element = (await TenantLayout({
        children: null,
        params: Promise.resolve({ tenant: "school-a" }),
      })) as ReactElement<{ tenant: { caldavEnabled?: boolean } }>;

      expect(element.props.tenant.caldavEnabled).toBe(expected);
    },
  );
});
