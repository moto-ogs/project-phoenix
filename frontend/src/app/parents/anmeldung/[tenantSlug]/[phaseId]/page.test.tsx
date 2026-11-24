import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "~/lib/swr/testing";
import { ApiError } from "~/lib/api-error";

// The form loads through real SWR under a parent session, a fresh cache per
// render.
vi.unmock("swr");

function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <SessionProvider
      session={{
        user: { id: "parent-1", scope: "parent" },
        expires: "2099-01-01",
      }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}

const mocks = vi.hoisted(() => ({
  fetchBootstrap: vi.fn(),
  fetchProfile: vi.fn(),
  resolveTenant: vi.fn(),
  submitEnrollment: vi.fn(),
  enrollmentForm: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("~/lib/tenant-context", () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
  useTenantSafe: () => null,
  useTenantSlugSafe: () => null,
}));

vi.mock("~/lib/tenant-api", () => ({
  resolveTenant: mocks.resolveTenant,
}));

vi.mock("~/lib/enrollment-submission-api", () => ({
  fetchParentEnrollmentBootstrap: mocks.fetchBootstrap,
}));

vi.mock("~/lib/parent-api", () => ({
  fetchParentEnrollmentProfile: mocks.fetchProfile,
  submitParentEnrollment: mocks.submitEnrollment,
}));

vi.mock("~/components/enrollment/enrollment-form", () => ({
  EnrollmentForm: (props: {
    gradeLevelMax: number;
    prefetchedData: { profile: unknown };
    onFormChanged?: () => Promise<void>;
  }) => {
    mocks.enrollmentForm(props);
    return (
      <div
        data-testid="parent-enrollment-form"
        data-care-term={useCareFacilityTerm()}
        data-grade-level-max={props.gradeLevelMax}
        data-has-profile={String(props.prefetchedData.profile !== null)}
      />
    );
  },
}));

import {
  CareFacilityTermScope,
  useCareFacilityTerm,
} from "~/lib/care-facility-term";
import ParentEnrollFormPage from "./page";

const tenant = {
  tenantId: "1",
  slug: "demo",
  name: "Demo School",
  subdomain: "demo",
  organizationId: 2,
  organizationName: "Demo Org",
  settings: {},
  presenceMode: "detailed",
  studentPhotosEnabled: false,
  nfcEnabled: false,
  messagingEnabled: false,
  displayEnabled: false,
  gradeLevelMax: 13,
};

const bootstrap = {
  phase: {
    id: "5",
    name: "2026/27",
    kind: "school_year",
    service_start_date: "2026-08-01",
    service_end_date: "2027-07-31",
    show_status_reason_to_parent: false,
    care_offering_selection_mode: "optional",
  },
  schema: null,
  offerings: [],
  care_offering_selection_mode: "optional",
  care_required: false,
  collect_grade_level: false,
  care_offerings_enabled: false,
  school_class: {
    collect: false,
    available_classes: [],
    require: false,
  },
  captcha_config: { enabled: true, site_key: "public-captcha" },
  legal_texts: { blocks: [] },
  // A tenant-session profile must never win on the parent portal.
  profile: {
    guardian: {
      first_name: "Wrong",
      last_name: "Session",
      email: "wrong@example.test",
    },
    children: [],
  },
};

const parentProfile = {
  guardian: {
    first_name: "Parent",
    last_name: "Portal",
    email: "parent@example.test",
  },
  children: [],
};

describe("ParentEnrollFormPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTenant.mockResolvedValue(tenant);
    mocks.fetchBootstrap.mockResolvedValue(bootstrap);
    mocks.fetchProfile.mockResolvedValue(parentProfile);
  });

  it("uses the resolved tenant cap and keeps autofill on the parent API", async () => {
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <ParentEnrollFormPage
            params={Promise.resolve({ tenantSlug: "demo", phaseId: "5" })}
          />
        </Suspense>,
        { wrapper: Providers },
      );
    });

    const form = await screen.findByTestId("parent-enrollment-form");
    expect(
      screen.getByText("Anmeldung für die OGS-Betreuung"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Zurück zum Elternportal" }),
    ).not.toBeInTheDocument();
    // Der oeffentliche Pfad, nicht die interne /parents-Route: auf dem
    // Eltern-Host schreibt der Proxy ohnehin um, und parentPath haelt die
    // Adresszeile sauber (siehe lib/parent-url.ts).
    expect(
      screen.getByRole("link", { name: "Zurück zu Neue Anmeldung" }),
    ).toHaveAttribute("href", "/anmeldung");
    expect(form.closest(".w-full")).toBeInTheDocument();
    expect(form.closest(".max-w-4xl")).not.toBeInTheDocument();
    expect(form).toHaveAttribute("data-grade-level-max", "13");
    expect(form).toHaveAttribute("data-has-profile", "true");
    expect(mocks.resolveTenant).toHaveBeenCalledWith("demo");
    // #1663: the parents portal loads form metadata through the
    // parent-authenticated bootstrap, not the anonymous public path.
    expect(mocks.fetchBootstrap).toHaveBeenCalledWith("demo", "5", {
      lateInviteToken: undefined,
    });
    expect(mocks.fetchProfile).toHaveBeenCalledWith("demo");
    expect(mocks.enrollmentForm).toHaveBeenCalledWith(
      expect.objectContaining({
        gradeLevelMax: 13,
        prefetchedData: expect.objectContaining({
          collectGradeLevel: false,
          careOfferingsEnabled: false,
          captchaConfig: null,
          profile: parentProfile,
        }),
      }),
    );
  });

  // The parents shell names the account's schools (#6082); the form names
  // the school it enrolls at, also when the account's schools say GTS.
  it("names the care of the school the form enrolls at", async () => {
    mocks.resolveTenant.mockResolvedValue({
      ...tenant,
      careFacilityTerm: "OGS",
    });
    await act(async () => {
      render(
        <CareFacilityTermScope term="GTS">
          <Suspense fallback={null}>
            <ParentEnrollFormPage
              params={Promise.resolve({ tenantSlug: "demo", phaseId: "5" })}
            />
          </Suspense>
        </CareFacilityTermScope>,
        { wrapper: Providers },
      );
    });

    const form = await screen.findByTestId("parent-enrollment-form");
    expect(form).toHaveAttribute("data-care-term", "OGS");
    expect(
      screen.getByText("Anmeldung für die OGS-Betreuung"),
    ).toBeInTheDocument();
  });

  // ADR 0311: the parent fills the version the opening read. When the
  // school published another one, the refused submit loads it, and the form
  // gets the current version handed in.
  it("loads the current form after a refused outdated version", async () => {
    const published = { id: "schema-2", fields: [], legal_blocks: [] };
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <ParentEnrollFormPage
            params={Promise.resolve({ tenantSlug: "demo", phaseId: "5" })}
          />
        </Suspense>,
        { wrapper: Providers },
      );
    });
    await screen.findByTestId("parent-enrollment-form");
    const shown = mocks.enrollmentForm.mock.lastCall?.[0] as {
      prefetchedData: { schema: unknown };
      onFormChanged: () => Promise<void>;
    };
    expect(shown.prefetchedData.schema).toBeNull();

    mocks.fetchBootstrap.mockResolvedValue({ ...bootstrap, schema: published });
    await act(() => shown.onFormChanged());

    expect(mocks.enrollmentForm.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        prefetchedData: expect.objectContaining({ schema: published }),
      }),
    );
  });

  it("rejects a failed reload after a refusal, so the form names it", async () => {
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <ParentEnrollFormPage
            params={Promise.resolve({ tenantSlug: "demo", phaseId: "5" })}
          />
        </Suspense>,
        { wrapper: Providers },
      );
    });
    await screen.findByTestId("parent-enrollment-form");
    const shown = mocks.enrollmentForm.mock.lastCall?.[0] as {
      onFormChanged: () => Promise<void>;
    };

    mocks.fetchBootstrap.mockRejectedValueOnce(
      new ApiError("unavailable", 503, { code: "general.unavailable" }),
    );
    await act(async () => {
      await expect(shown.onFormChanged()).rejects.toThrow("unavailable");
    });
    expect(screen.getByTestId("parent-enrollment-form")).toBeInTheDocument();
  });

  // A cached form shows at once, but the opening's own read decides: when
  // the window closed or the invitation was revoked meanwhile, the page
  // shows that failure instead of a form the server would refuse.
  it("shows the failed first read of an opening over a cached form", async () => {
    const cache = new Map();
    function SharedCache({
      children,
    }: Readonly<{ children: React.ReactNode }>) {
      return (
        <SessionProvider
          session={{
            user: { id: "parent-1", scope: "parent" },
            expires: "2099-01-01",
          }}
          refetchOnWindowFocus={false}
        >
          <SWRConfig
            value={{
              provider: () => cache,
              errorRetryCount: 0,
              dedupingInterval: 0,
            }}
          >
            {children}
          </SWRConfig>
        </SessionProvider>
      );
    }
    const open = async () => {
      let unmount = () => undefined as void;
      await act(async () => {
        ({ unmount } = render(
          <Suspense fallback={null}>
            <ParentEnrollFormPage
              params={Promise.resolve({ tenantSlug: "demo", phaseId: "5" })}
            />
          </Suspense>,
          { wrapper: SharedCache },
        ));
      });
      return unmount;
    };
    const closeFirst = await open();
    await screen.findByTestId("parent-enrollment-form");
    closeFirst();

    mocks.fetchBootstrap.mockRejectedValue(
      new ApiError("window closed", 404, { code: "enrollment.window_closed" }),
    );
    await open();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByTestId("parent-enrollment-form"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows an error instead of falling back when tenant metadata is unavailable", async () => {
    // #2353: the failed lookup carries its request ID to the parent.
    mocks.resolveTenant.mockRejectedValueOnce(
      new ApiError("tenant lookup failed", 500, {
        code: "general.server",
        instance: "req-tenant",
      }),
    );

    await act(async () => {
      render(
        <Suspense fallback={null}>
          <ParentEnrollFormPage
            params={Promise.resolve({ tenantSlug: "demo", phaseId: "5" })}
          />
        </Suspense>,
        { wrapper: Providers },
      );
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByText("Vorgangskennung: req-tenant"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByTestId("parent-enrollment-form"),
      ).not.toBeInTheDocument();
    });
  });
});
