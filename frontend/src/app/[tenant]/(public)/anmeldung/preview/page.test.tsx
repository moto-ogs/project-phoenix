import type { Session } from "next-auth";
import { Suspense } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { TEST_CLOCK_INSTANT } from "~/test/clock";
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "~/lib/swr/testing";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

// The preview reads through real SWR under a staff session, a fresh cache
// per render.
vi.unmock("swr");

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  redirect: vi.fn(),
  fetchEnrollmentPreviewBootstrap: vi.fn(),
  listPhases: vi.fn(),
  fetchPublicLegalTexts: vi.fn(),
  formProps: [] as Record<string, unknown>[],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.search,
  redirect: mocks.redirect,
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenant: () => ({
    tenantSlug: "demo",
    tenant: { name: "Demo School", gradeLevelMax: 4 },
  }),
  useTenantSlugSafe: () => "demo",
  useTenantRoutingModeSafe: () => "path",
}));

vi.mock("~/lib/enrollment-form-schema-api", () => ({
  fetchEnrollmentPreviewBootstrap: mocks.fetchEnrollmentPreviewBootstrap,
  fetchPublicLegalTexts: mocks.fetchPublicLegalTexts,
  schemaToPublicFormSchema: (schema: unknown) => schema,
}));

vi.mock("~/lib/enrollment-phase-api", () => ({
  listPhases: mocks.listPhases,
}));

vi.mock("~/components/enrollment/enrollment-form", () => ({
  EnrollmentForm: (props: Record<string, unknown>) => {
    mocks.formProps.push(props);
    return <p>Elternformular</p>;
  },
}));

vi.mock("~/components/enrollment/public-enrollment-shell", () => ({
  PublicEnrollmentBrand: () => null,
  PublicEnrollmentLocaleSwitcher: () => null,
  PublicEnrollmentPageShell: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  PublicEnrollmentSteps: () => null,
  PublicInfoCard: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <section aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  ),
}));

import EnrollmentPreviewPage from "./page";

const staffSession: Session = {
  user: { id: "staff-7", scope: "tenant", tenantId: 42 },
  expires: "2099-01-01",
};
function Providers({
  children,
  session = staffSession,
}: Readonly<{ children: React.ReactNode; session?: Session | null }>) {
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}

async function renderPage(session: Session | null = staffSession) {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <EnrollmentPreviewPage />
      </Suspense>,
      {
        wrapper: ({ children }) => (
          <Providers session={session}>{children}</Providers>
        ),
      },
    );
  });
}

const schema = { id: "80", name: "Anmeldung Ganztag", fields: [] };
const schoolLegalTexts = { blocks: [], agb: "", dsgvo: "" };
const ownLegalBlock = {
  key: "custom_photo_trip",
  kind: "consent",
  title: "Fotoausflug",
  label: "Mein Kind darf beim Ausflug fotografiert werden.",
  text: "Details zum Fotoausflug",
  required: true,
  enabled: true,
  sort_order: 10,
  source: "custom",
};

function phase(overrides: Record<string, unknown> = {}) {
  return {
    id: "13",
    name: "2. Halbjahr 2026/27",
    form_schema_id: "80",
    is_active: true,
    care_offering_selection_mode: "optional",
    eligible_grade_levels: [],
    ...overrides,
  };
}

function offering(overrides: Record<string, unknown>) {
  return {
    phase_id: "13",
    days_of_week_mode: "parent_choice",
    available_days: ["mon", "tue", "wed", "thu"],
    includes_holiday_care: false,
    includes_lunch: false,
    is_active: true,
    is_required: false,
    sort_order: 0,
    ...overrides,
  };
}

describe("EnrollmentPreviewPage", () => {
  beforeEach(() => {
    mocks.search = new URLSearchParams();
    mocks.redirect.mockClear();
    mocks.formProps = [];
    mocks.fetchEnrollmentPreviewBootstrap.mockReset();
    mocks.listPhases.mockReset();
    mocks.listPhases.mockResolvedValue([]);
    mocks.fetchPublicLegalTexts.mockReset();
    mocks.fetchPublicLegalTexts.mockResolvedValue(schoolLegalTexts);
  });

  it("hands the school's legal texts to a template without blocks of its own", async () => {
    mocks.search = new URLSearchParams("schemaId=80");
    mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({ schema });
    await renderPage();

    expect(await screen.findByText("Elternformular")).toBeInTheDocument();
    expect(mocks.fetchPublicLegalTexts).toHaveBeenCalledWith("demo");
    expect(mocks.formProps.at(-1)?.previewLegalTexts).toBe(schoolLegalTexts);
  });

  it("reads no school legal texts for a template with blocks of its own", async () => {
    mocks.search = new URLSearchParams("schemaId=80");
    mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
      schema: { ...schema, legal_blocks: [ownLegalBlock] },
    });
    await renderPage();

    expect(await screen.findByText("Elternformular")).toBeInTheDocument();
    expect(mocks.fetchPublicLegalTexts).not.toHaveBeenCalled();
  });

  it("stops the preview when the school's legal texts fail, then retries", async () => {
    // A real load failure must replace the form, so it never shows consent
    // without the configured documents.
    mocks.search = new URLSearchParams("schemaId=80");
    mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({ schema });
    mocks.fetchPublicLegalTexts.mockReset();
    mocks.fetchPublicLegalTexts
      .mockRejectedValueOnce(
        new ApiError("legal texts request failed: 500", 500),
      )
      .mockResolvedValueOnce(schoolLegalTexts);
    await renderPage();

    // The backend sentence never reaches the reader.
    expect(
      await screen.findByText(catalogText("general.server", "die Vorschau")),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("legal texts request failed: 500"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Elternformular")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    expect(await screen.findByText("Elternformular")).toBeInTheDocument();
  });

  it("redirects an unauthenticated base preview to the school's login without reading protected data", async () => {
    mocks.search = new URLSearchParams("base=1");
    await renderPage(null);
    expect(mocks.redirect).toHaveBeenCalledWith("/demo/");
    expect(mocks.fetchEnrollmentPreviewBootstrap).not.toHaveBeenCalled();
    expect(mocks.listPhases).not.toHaveBeenCalled();
  });

  // Der Rückweg zeigte auf `/enrollment-form` ohne Schule und landete im
  // Pfad-Modus außerhalb des Tenant-Portals (#4364).
  it("links back to the enrollment forms of the same school", async () => {
    await renderPage();

    expect(
      await screen.findByRole("link", {
        name: "Zurück zu den Anmeldeformularen",
      }),
    ).toHaveAttribute("href", "/demo/enrollment-form");
  });

  // #6044: a school created offerings, opened this template preview and
  // found no offerings. The page pointed to a „Phasenvorschau“ that existed
  // nowhere. It must lead to a preview with the offerings of every phase
  // that uses the template, in whatever state the phase is.
  it("links to the preview of every phase that uses the template", async () => {
    mocks.search = new URLSearchParams("schemaId=80");
    mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
      schema,
      assigned_phase_count: 3,
      active_assigned_phase_count: 2,
    });
    mocks.listPhases.mockResolvedValue([
      phase(),
      phase({ id: "14", name: "Schuljahr 2027/28", is_active: false }),
      phase({
        id: "15",
        name: "Wiederanmeldung",
        audience: "existing_students",
      }),
      phase({ id: "16", name: "Ferien", form_schema_id: "99" }),
    ]);

    await renderPage();

    expect(
      await screen.findByRole("link", {
        name: "Vorschau von „2. Halbjahr 2026/27“ mit Angeboten öffnen",
      }),
    ).toHaveAttribute("href", "/demo/anmeldung/preview?phaseId=13");
    expect(
      screen.getByRole("link", {
        name: "Vorschau von „2. Halbjahr 2026/27“ mit Angeboten öffnen",
      }),
    ).toHaveAttribute("data-button-link");
    expect(
      screen.getByRole("link", {
        name: "Vorschau von „Schuljahr 2027/28“ mit Angeboten öffnen",
      }),
    ).toHaveAttribute("href", "/demo/anmeldung/preview?phaseId=14");
    expect(
      screen.getByRole("link", {
        name: "Vorschau von „Wiederanmeldung“ mit Angeboten öffnen",
      }),
    ).toHaveAttribute("href", "/demo/anmeldung/preview?phaseId=15");
    expect(screen.queryByText("Ferien")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Diese Vorlage wird in 2 aktiven Anmeldephasen verwendet.",
        { exact: false },
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Phasenvorschau/)).not.toBeInTheDocument();
  });

  it("says where to assign a template no phase uses", async () => {
    mocks.search = new URLSearchParams("schemaId=80");
    mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
      schema,
      assigned_phase_count: 0,
      active_assigned_phase_count: 0,
    });

    await renderPage();

    expect(
      await screen.findByText(
        "Diese Vorlage gehört noch zu keiner Anmeldephase.",
        { exact: false },
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /mit Angeboten öffnen/ }),
    ).not.toBeInTheDocument();
  });

  // #6044: Barnstorf's phase was inactive and its window closed. Its public
  // link showed parents an error, and no staff view showed the offerings.
  it("previews an inactive phase with its active offerings in catalog order", async () => {
    mocks.search = new URLSearchParams("phaseId=13");
    mocks.listPhases.mockResolvedValue([
      phase({
        is_active: false,
        care_offering_selection_mode: "at_least_one",
        eligible_grade_levels: [1, 2],
      }),
    ]);
    mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
      schema,
      assigned_phase_count: 1,
      active_assigned_phase_count: 0,
      enrollment_enabled: true,
      phase_offerings: {
        offerings: [
          offering({ id: "3", name: "Früh", sort_order: 0 }),
          offering({ id: "1", name: "Spät", sort_order: 2 }),
        ],
        care_offering_selection_mode: "at_least_one",
        eligible_grade_levels: [1, 2],
        school_class: {
          collect: true,
          available_classes: ["2a"],
          require: true,
          collect_grade_1: false,
        },
        collect_grade_level: true,
        care_offerings_enabled: true,
      },
    });

    await renderPage();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "2. Halbjahr 2026/27",
      }),
    ).toBeVisible();
    expect(screen.getByText("Elternformular")).toBeVisible();
    expect(mocks.fetchEnrollmentPreviewBootstrap).toHaveBeenCalledWith({
      schemaId: "80",
      phaseId: "13",
    });
    const props = mocks.formProps.at(-1)!;
    expect(props.previewMode).toBe(true);
    expect(props.previewSchema).toEqual(schema);
    expect(props.previewOfferings).toEqual({
      offerings: [
        expect.objectContaining({ id: "3" }),
        expect.objectContaining({ id: "1" }),
      ],
      careOfferingSelectionMode: "at_least_one",
      eligibleGradeLevels: [1, 2],
      schoolClass: {
        collect: true,
        available_classes: ["2a"],
        require: true,
        collect_grade_1: false,
      },
      collectGradeLevel: true,
      careOfferingsEnabled: true,
    });
    expect(
      screen.getAllByText("Eltern erreichen diese Phase noch nicht").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Wähle unter Anmeldephasen bei dieser Phase „Aktivieren“.",
        { exact: false },
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Zurück zu den Anmeldephasen" }),
    ).toHaveAttribute("href", "/demo/enrollment-phases");
  });

  it("previews a phase on the base form", async () => {
    mocks.search = new URLSearchParams("phaseId=13");
    mocks.listPhases.mockResolvedValue([phase({ form_schema_id: null })]);
    mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
      enrollment_enabled: true,
      phase_offerings: {
        offerings: [],
        care_offering_selection_mode: "optional",
        eligible_grade_levels: [],
        collect_grade_level: true,
        care_offerings_enabled: true,
      },
      schema: null,
      assigned_phase_count: 0,
      active_assigned_phase_count: 0,
    });

    await renderPage();

    expect(await screen.findByText("Elternformular")).toBeVisible();
    expect(mocks.fetchEnrollmentPreviewBootstrap).toHaveBeenCalledWith({
      base: true,
      phaseId: "13",
    });
  });

  it.each([
    {
      state: "not yet open",
      overrides: {
        enrollment_open_at: new Date(
          TEST_CLOCK_INSTANT.getTime() + 60_000,
        ).toISOString(),
      },
      hint: "Die Elternansicht ist erst ab der Öffnung erreichbar.",
    },
    {
      state: "at closing time",
      overrides: { enrollment_close_at: TEST_CLOCK_INSTANT.toISOString() },
      hint: "Das Anmeldefenster ist geschlossen.",
    },
  ])(
    "explains why parents cannot reach a $state phase yet",
    async ({ overrides, hint }) => {
      mocks.search = new URLSearchParams("phaseId=13");
      mocks.listPhases.mockResolvedValue([phase(overrides)]);
      mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
        enrollment_enabled: true,
        phase_offerings: {
          offerings: [],
          care_offering_selection_mode: "optional",
          eligible_grade_levels: [],
          collect_grade_level: true,
          care_offerings_enabled: true,
        },
        schema,
        assigned_phase_count: 1,
        active_assigned_phase_count: 1,
      });

      await renderPage();

      expect(await screen.findByText(hint, { exact: false })).toBeVisible();
      expect(screen.getByText("Elternformular")).toBeVisible();
    },
  );

  it("names an open phase as reachable from opening until closing", async () => {
    mocks.search = new URLSearchParams("phaseId=13");
    mocks.listPhases.mockResolvedValue([
      phase({
        enrollment_open_at: TEST_CLOCK_INSTANT.toISOString(),
        enrollment_close_at: new Date(
          TEST_CLOCK_INSTANT.getTime() + 60_000,
        ).toISOString(),
      }),
    ]);
    mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
      enrollment_enabled: true,
      phase_offerings: {
        offerings: [],
        care_offering_selection_mode: "optional",
        eligible_grade_levels: [],
        school_class: { collect: false, available_classes: [], require: false },
        collect_grade_level: true,
        care_offerings_enabled: true,
      },
      schema,
      assigned_phase_count: 1,
      active_assigned_phase_count: 1,
    });

    await renderPage();

    expect(
      (await screen.findAllByText("Eltern erreichen diese Phase")).length,
    ).toBeGreaterThan(0);
  });
  it.each(["existing_students", "linked_parents"])(
    "describes portal access and availability independently for %s",
    async (audience) => {
      const cases = [
        { overrides: {}, reason: null },
        { overrides: { is_active: false }, reason: "Aktivieren" },
        {
          overrides: {
            enrollment_open_at: new Date(
              TEST_CLOCK_INSTANT.getTime() + 60_000,
            ).toISOString(),
          },
          reason: "erst ab der Öffnung",
        },
        {
          overrides: { enrollment_close_at: TEST_CLOCK_INSTANT.toISOString() },
          reason: "Anmeldefenster ist geschlossen",
        },
      ];
      for (const { overrides, reason } of cases) {
        mocks.search = new URLSearchParams("phaseId=13");
        mocks.listPhases.mockResolvedValue([phase({ audience, ...overrides })]);
        mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
          schema,
          enrollment_enabled: true,
          phase_offerings: {
            offerings: [],
            care_offering_selection_mode: "optional",
            eligible_grade_levels: [],
          },
        });
        const { unmount } = render(<EnrollmentPreviewPage />, {
          wrapper: Providers,
        });
        expect(
          await screen.findByText(
            "Die Anmeldung läuft über das Elternportal.",
            { exact: false },
          ),
        ).toBeVisible();
        expect(
          screen.getByText("Der öffentliche Link öffnet diese Phase nicht.", {
            exact: false,
          }),
        ).toBeVisible();
        expect(
          screen.queryByText("Nur mit Einladungslink erreichbar."),
        ).not.toBeInTheDocument();
        if (reason) {
          expect(screen.getByText(reason, { exact: false })).toBeVisible();
          expect(
            screen.getAllByText("Eltern erreichen diese Phase noch nicht"),
          ).toHaveLength(2);
        } else {
          expect(
            screen.getAllByText("Über das Elternportal erreichbar"),
          ).toHaveLength(2);
        }
        unmount();
      }
    },
  );

  it.each(["open", "existing_students", "linked_parents"])(
    "keeps a %s preview available but blocks reachability when school enrollment is off",
    async (audience) => {
      mocks.search = new URLSearchParams("phaseId=13");
      mocks.listPhases.mockResolvedValue([phase({ audience })]);
      mocks.fetchEnrollmentPreviewBootstrap.mockResolvedValue({
        schema,
        enrollment_enabled: false,
        phase_offerings: {
          offerings: [],
          care_offering_selection_mode: "optional",
          eligible_grade_levels: [],
        },
      });
      await renderPage();
      expect(
        await screen.findByText(
          "Die Online-Anmeldung ist für diese Schule ausgeschaltet.",
          { exact: false },
        ),
      ).toBeVisible();
      expect(
        screen.getByText(
          "Schalte unter „Einstellungen“ > „Anmeldung“ die „Online-Anmeldung“ ein.",
          { exact: false },
        ),
      ).toBeVisible();
      expect(
        screen.getAllByText("Eltern erreichen diese Phase noch nicht"),
      ).toHaveLength(2);
      expect(screen.getByText("Elternformular")).toBeVisible();
      expect(
        screen.queryByText("Eltern melden sich über den Link der Phase an."),
      ).not.toBeInTheDocument();
    },
  );
});
