import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import type { ResolvedSetting, SettingsSchema } from "~/lib/settings-api";
import type { SchoolResponsibility } from "~/lib/traeger-responsibilities-api";

vi.unmock("swr");
const { api, traegerApi, session, push } = vi.hoisted(() => ({
  api: { fetchResponsibilities: vi.fn() },
  traegerApi: {
    fetchTraegerSettingsSchema: vi.fn(),
    saveTraegerSettingValue: vi.fn(),
    clearTraegerSettingValue: vi.fn(),
  },
  session: {
    permissions: ["traeger_overview:read", "traeger_settings:manage"],
  },
  push: vi.fn(),
}));

vi.mock("~/lib/traeger-responsibilities-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...traegerApi,
}));
vi.mock("~/lib/traeger-billing-issuers-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchBillingIssuerStatuses: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/einstellungen/zustaendigkeiten",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "A",
        scope: "org",
        orgId: "7",
        permissions: session.permissions,
      },
    },
    status: "authenticated",
  }),
}));

import TraegerResponsibilitiesPage from "./page";

const OPTIONS = [
  { label: "Träger", value: "traeger" },
  { label: "Schulträger", value: "schultraeger" },
  { label: "Gemeinde", value: "gemeinde" },
];

function setting(
  key: string,
  label: string,
  value: string,
  writable: boolean,
): ResolvedSetting {
  return {
    key,
    label,
    description: "",
    type: "select",
    value,
    default: "traeger",
    is_default: true,
    source: value === "traeger" ? "default" : "traeger",
    levels: "beide",
    writable,
    visible: true,
    sort_order: 10,
    access_policy: "shared",
    validation: null,
    depends_on: null,
    options: { static: OPTIONS },
  };
}

function schema(writable: boolean): SettingsSchema {
  return {
    tabs: [
      {
        key: "zustaendigkeiten",
        label: "zustaendigkeiten",
        categories: [
          {
            key: "zustaendige-stellen",
            label: "zustaendige-stellen",
            items: [
              setting(
                "responsibility.contracts",
                "Wer schließt die Betreuungsverträge?",
                "gemeinde",
                writable,
              ),
              setting(
                "responsibility.billing",
                "Wer rechnet mit den Eltern ab?",
                "traeger",
                writable,
              ),
              setting(
                "responsibility.staff",
                "Wer stellt das Personal an?",
                "traeger",
                writable,
              ),
            ],
          },
        ],
      },
    ],
  };
}

const SCHOOLS: SchoolResponsibility[] = [
  {
    schoolId: "11",
    schoolName: "OGS Nord",
    areas: [
      {
        area: "contracts",
        body: "gemeinde",
        source: "traeger",
        effective: "gemeinde",
      },
      {
        area: "billing",
        body: "traeger",
        source: "default",
        effective: "traeger",
      },
      {
        area: "staff",
        body: "gemeinde",
        source: "school",
        effective: "gemeinde",
      },
    ],
    parties: [
      {
        kind: "gemeinde",
        name: "Gemeinde Hardt",
        street: "Rathausplatz 1",
        postalCode: "41749",
        city: "Viersen",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        creditorId: "",
        accountHolder: "",
        iban: "",
        bic: "",
        bankName: "",
        version: "v1",
      },
    ],
  },
  {
    schoolId: "12",
    schoolName: "OGS Süd",
    areas: [
      {
        area: "contracts",
        body: "gemeinde",
        source: "traeger",
        effective: "traeger",
      },
      {
        area: "billing",
        body: "traeger",
        source: "default",
        effective: "traeger",
      },
      {
        area: "staff",
        body: "traeger",
        source: "default",
        effective: "traeger",
      },
    ],
    parties: [],
  },
];

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <ToastProvider>
        <TraegerResponsibilitiesPage />
      </ToastProvider>
    </SWRConfig>,
  );
}

describe("TraegerResponsibilitiesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.permissions = ["traeger_overview:read", "traeger_settings:manage"];
    api.fetchResponsibilities.mockResolvedValue(SCHOOLS);
    traegerApi.fetchTraegerSettingsSchema.mockResolvedValue(schema(true));
  });

  it("shows the value for all schools and who is responsible at each school", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: /Für alle Schulen/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Wer schließt die Betreuungsverträge?"),
    ).toBeInTheDocument();

    const north = within(
      (await screen.findAllByText("OGS Nord"))[0]!.closest("tr")!,
    );
    // The stored Gemeinde concludes contracts and, by the school's own
    // value, employs the staff.
    expect(north.getAllByText("Gemeinde Hardt")).toHaveLength(2);
    expect(north.getByText("Eigener Wert")).toBeInTheDocument();

    const south = within(screen.getAllByText("OGS Süd")[0]!.closest("tr")!);
    // The Träger value names the Gemeinde, but this school has none stored.
    expect(south.getByText("Gewählt: Gemeinde")).toBeInTheDocument();
    expect(south.getByText("Angaben fehlen")).toBeInTheDocument();

    // The figures of the page: schools, own values, missing master data.
    expect(
      screen.getByText("mit eigenem Wert").parentElement,
    ).toHaveTextContent("1");
    expect(
      screen.getByText("mit fehlenden Angaben").parentElement,
    ).toHaveTextContent("1");
  });

  it("says who may change the values to an account that only reads", async () => {
    session.permissions = ["traeger_overview:read"];
    traegerApi.fetchTraegerSettingsSchema.mockResolvedValue(schema(false));
    renderPage();

    expect(
      await screen.findByText(/Du kannst die Zuständigkeiten nur ansehen/),
    ).toBeInTheDocument();
    expect(await screen.findAllByText("OGS Nord")).not.toHaveLength(0);
  });
});
