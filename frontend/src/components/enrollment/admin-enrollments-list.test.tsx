import {
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

// Reads run through real SWR under a staff session, a fresh cache per render.
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{
        // The privacy-notice warning (#7176) shows only to people who may
        // change the settings.
        user: {
          id: "staff-7",
          scope: "tenant",
          tenantId: "42",
          permissions: ["config:update", "config:manage"],
        },
        expires: "2099-01-01",
      }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    </SessionProvider>
  );
}
const render = (ui: ReactElement) =>
  renderComponent(ui, { wrapper: Providers });

const mocks = vi.hoisted(() => ({
  fetchSettingsSchema: vi.fn(),
  listAdminEnrollmentChangeRequests: vi.fn(),
  listAdminRequests: vi.fn(),
  fetchCareOfferingCounts: vi.fn(),
  listPhases: vi.fn(),
  listSchemas: vi.fn(),
}));

vi.mock("~/lib/enrollment-admin-api", () => ({
  listAdminEnrollmentChangeRequests: mocks.listAdminEnrollmentChangeRequests,
  listAdminRequests: mocks.listAdminRequests,
}));

vi.mock("~/lib/enrollment-phase-api", () => ({
  listPhases: mocks.listPhases,
}));

vi.mock("~/lib/care-offering-api", () => ({
  fetchCareOfferingCounts: mocks.fetchCareOfferingCounts,
}));

vi.mock("~/lib/enrollment-form-schema-api", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listSchemas: mocks.listSchemas,
  };
});

vi.mock("~/lib/settings-api", () => ({
  fetchSettingsSchema: mocks.fetchSettingsSchema,
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "demo",
  useTenantRoutingModeSafe: () => "path",
}));

import { AdminEnrollmentsList } from "./admin-enrollments-list";
import type { Phase } from "~/lib/enrollment-phase-api";

function phase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "10",
    name: "Schuljahr 2026/27",
    kind: "school_year",
    version: "phase-read",
    service_start_date: "2026-09-01",
    service_end_date: "2027-07-31",
    enrollment_open_at: undefined,
    enrollment_close_at: undefined,
    form_schema_id: undefined,
    show_status_reason_to_parent: false,
    care_overflow_mode: "waitlist",
    care_offering_selection_mode: "optional",
    is_active: true,
    rollover_auto_approve: false,
    rollover_bumps_grade: false,
    available_school_classes: [],
    require_school_class: false,
    audience: "open",
    eligible_school_classes: [],
    eligible_grade_levels: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function settingsSchema(
  enrollmentEnabled: boolean,
  privacyNotice = { enabled: true, text: "Datenschutzinformation" },
) {
  return {
    tabs: [
      {
        key: "enrollment",
        label: "Anmeldung",
        categories: [
          {
            key: "general",
            label: "Allgemein",
            items: [
              {
                key: "enrollment.enabled",
                value: enrollmentEnabled,
              },
              {
                key: "enrollment.legal_dsgvo_enabled",
                value: privacyNotice.enabled,
              },
              {
                key: "enrollment.legal_dsgvo_text",
                value: privacyNotice.text,
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  mocks.fetchSettingsSchema.mockReset();
  mocks.listAdminEnrollmentChangeRequests.mockReset();
  mocks.listAdminRequests.mockReset();
  mocks.fetchCareOfferingCounts.mockReset();
  mocks.listPhases.mockReset();
  mocks.listSchemas.mockReset();

  mocks.fetchSettingsSchema.mockResolvedValue(settingsSchema(false));
  mocks.listAdminEnrollmentChangeRequests.mockResolvedValue([]);
  mocks.listAdminRequests.mockResolvedValue([]);
  mocks.fetchCareOfferingCounts.mockResolvedValue({});
  mocks.listPhases.mockResolvedValue([]);
  mocks.listSchemas.mockResolvedValue([]);
});

describe("AdminEnrollmentsList setup guide", () => {
  it("warns while the online enrollment runs without a privacy notice", async () => {
    mocks.fetchSettingsSchema.mockResolvedValue(
      settingsSchema(true, { enabled: false, text: "" }),
    );

    render(<AdminEnrollmentsList />);

    expect(
      await screen.findByText("Datenschutzinformation fehlt"),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Zur Datenschutzinformation" }),
    ).toHaveAttribute(
      "href",
      "/demo/settings?tab=enrollment&highlight=enrollment.legal_dsgvo_enabled",
    );
  });

  it("does not count the form step as complete before a phase exists", async () => {
    render(<AdminEnrollmentsList />);

    await waitFor(() => {
      expect(screen.getByText("Online-Anmeldung vorbereiten")).toBeVisible();
    });

    expect(screen.getByText("0 von 5 Schritten erledigt")).toBeVisible();
    expect(screen.getAllByText("Anmeldeformular festlegen")).toHaveLength(2);
    expect(screen.getAllByText("Wartet auf Phase")).toHaveLength(2);
  });

  it("counts the form step once an active phase uses the base form", async () => {
    mocks.listPhases.mockResolvedValue([phase()]);

    render(<AdminEnrollmentsList />);

    await waitFor(() => {
      expect(screen.getByText("Online-Anmeldung vorbereiten")).toBeVisible();
    });

    expect(screen.getByText("2 von 5 Schritten erledigt")).toBeVisible();
    expect(screen.getByText("Basisformular")).toBeVisible();
  });

  it("offers no public form link for an audience-restricted phase", async () => {
    mocks.listPhases.mockResolvedValue([
      phase({ id: "12", audience: "linked_parents" }),
    ]);

    render(<AdminEnrollmentsList />);

    expect(
      await screen.findByRole("link", { name: "Anmeldungen ansehen" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Formular ansehen" }),
    ).not.toBeInTheDocument();
  });

  it("uses tenant-aware enrollment links", async () => {
    mocks.listPhases.mockResolvedValue([phase({ id: "12" })]);

    render(<AdminEnrollmentsList />);

    const link = await screen.findByRole("link", {
      name: "Anmeldungen ansehen",
    });
    expect(link).toHaveAttribute("href", "/demo/admin/enrollments/phases/12");
    expect(
      screen.getByRole("link", { name: "Elternansicht öffnen" }),
    ).toHaveAttribute("href", "/demo/anmeldung");
    expect(
      screen.getByRole("link", { name: "Formular ansehen" }),
    ).toHaveAttribute("href", "/demo/anmeldung/12");
    for (const previewLink of screen.getAllByRole("link", {
      name: /Elternansicht testen/,
    })) {
      expect(previewLink).toHaveAttribute("href", "/demo/anmeldung");
    }
    expect(
      screen.queryByRole("button", { name: /Nachzügler/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Manuell/ }),
    ).not.toBeInTheDocument();
  });

  it("shows an unknown state when change requests fail to load", async () => {
    mocks.listAdminEnrollmentChangeRequests.mockRejectedValue(
      new ApiError("forbidden", 403, { code: "general.permission" }),
    );

    render(<AdminEnrollmentsList />);

    await waitFor(() => {
      expect(screen.getByText("Online-Anmeldung vorbereiten")).toBeVisible();
    });

    expect(
      await screen.findByText(
        catalogText("general.permission", "die Liste der Änderungsanfragen"),
      ),
    ).toBeVisible();
    // Keine Zählkacheln: 0 offen wäre falsch.
    expect(screen.queryByText("Offen")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Aktuell wartet keine Änderungsanfrage auf Bearbeitung.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Anfragen prüfen/ }),
    ).toHaveAttribute("href", "/demo/anfragen");
  });

  it("shows only the load error when the overview cannot load", async () => {
    mocks.listAdminRequests.mockRejectedValue(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );
    const onSummaryChange = vi.fn();

    render(<AdminEnrollmentsList onSummaryChange={onSummaryChange} />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Übersicht der Anmeldungen"),
      ),
    ).toBeVisible();
    // Kein Einrichtungsleitfaden mit falschen Schritten, kein Leerzustand.
    expect(
      screen.queryByText("Online-Anmeldung vorbereiten"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Noch keine Anmeldephase"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeVisible();
    // The summary is published by an effect after the error is rendered.
    await waitFor(() => {
      expect(onSummaryChange).toHaveBeenLastCalledWith("unavailable");
    });
  });

  it("fails the whole overview instead of guessing setup steps", async () => {
    mocks.fetchSettingsSchema.mockRejectedValue(
      new ApiError("down", 500, { code: "general.server" }),
    );

    render(<AdminEnrollmentsList />);

    expect(
      await screen.findByText(
        catalogText("general.server", "die Übersicht der Anmeldungen"),
      ),
    ).toBeVisible();
    expect(screen.queryByText("Ausgeschaltet")).not.toBeInTheDocument();
  });
});
