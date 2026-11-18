import {
  act,
  render as renderPlain,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReactElement, ReactNode } from "react";
import type { SchoolSearchResult } from "~/lib/school-search";
import { SWRConfig } from "~/lib/swr/testing";

// The search reads through the shared cache; each render gets its own.
vi.unmock("swr");

function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

function render(ui: ReactElement) {
  return renderPlain(ui, { wrapper: Providers });
}

const {
  mockUseSession,
  mockPush,
  mockSearchSchool,
  mockShowLoadError,
  mockClearLoadError,
  mockUseSettingsSchema,
  loadError,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockPush: vi.fn(),
  mockSearchSchool: vi.fn(),
  mockShowLoadError: vi.fn(),
  mockClearLoadError: vi.fn(),
  mockUseSettingsSchema: vi.fn(),
  loadError: { current: null as null | { message: string } },
}));

vi.mock("next-auth/react", () => ({ useSession: () => mockUseSession() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/home",
}));
vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));
vi.mock("~/lib/hooks/use-module-navigation", () => ({
  useModuleNavigation: () => ({ page: () => "open", section: () => "open" }),
}));
// Personalprofil in dieser Schule laut Nutzerkontext (#7306).
const ownStaff = vi.hoisted(() => ({ present: true }));
vi.mock("~/lib/hooks/use-user-context", () => ({
  useHasOwnStaff: () => ownStaff.present,
}));
vi.mock("~/lib/hooks/use-change-request-access", () => ({
  useChangeRequestAccess: () => ({ canOpenRequestsPage: false }),
}));
vi.mock("~/lib/hooks/use-school-switches", () => ({
  useSchoolParentNewsEnabled: () => false,
}));
vi.mock("~/lib/hooks/use-settings-schema", () => ({
  useSettingsSchema: (enabled: boolean) => mockUseSettingsSchema(enabled),
}));
// The help path has its own test (school-search-help.test.ts).
vi.mock("./school-search-help", () => ({
  loadHelpIndex: async () => [],
  helpEntriesOf: () => [],
}));
vi.mock("~/contexts/ToastContext", () => ({
  useApiLoadError: () => ({
    error: loadError.current,
    show: mockShowLoadError,
    clear: mockClearLoadError,
  }),
}));
vi.mock("~/lib/school-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/school-search")>()),
  searchSchool: (...args: unknown[]) => mockSearchSchool(...args),
}));
vi.mock("~/components/ui/form-error-alert", () => ({
  LoadErrorAlert: ({ error }: { error: { message: string } }) => (
    <p role="alert">{error.message}</p>
  ),
}));

import { SchoolSearchDialog } from "./school-search";

const FULL_SCOPE = {
  children: true,
  childDetails: true,
  contacts: true,
  staff: true,
  rooms: true,
  groups: true,
} as const;

const EMPTY: SchoolSearchResult = {
  children: [],
  contacts: [],
  staff: [],
  rooms: [],
  groups: [],
  scope: FULL_SCOPE,
};

const SETTINGS_SCHEMA = {
  tabs: [
    {
      key: "gdpr",
      label: "gdpr",
      categories: [
        {
          key: "datenbereinigung",
          label: "datenbereinigung",
          items: [
            {
              key: "gdpr.retention_days",
              label: "Aufbewahrungsfrist",
              description: "Nach so vielen Tagen löscht moto Besuchsdaten.",
              type: "int",
              default: 30,
              value: 30,
              writable: true,
              visible: true,
            },
          ],
        },
      ],
    },
  ],
};

function child(id: string, firstName: string, lastName: string) {
  return {
    id,
    firstName,
    lastName,
    schoolClass: "3a",
    match: { field: "name" as const },
  };
}

function signIn(permissions: string[]) {
  mockUseSession.mockReturnValue({
    data: { user: { id: "1", token: "t", roles: [], permissions } },
    status: "authenticated",
  });
}

async function typeQuery(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole("combobox"), text);
  // The search waits for a pause in typing before it asks the server.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
  return user;
}

describe("SchoolSearchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadError.current = null;
    mockSearchSchool.mockResolvedValue(EMPTY);
    mockUseSettingsSchema.mockImplementation((enabled: boolean) => ({
      data: enabled ? SETTINGS_SCHEMA : undefined,
    }));
  });

  it("offers the pages the account may open before anything is typed", () => {
    signIn(["users:read"]);
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    const pages = screen.getByRole("group", { name: "Seiten" });
    expect(
      within(pages).getByRole("option", { name: "Alle Kinder" }),
    ).toBeInTheDocument();
    expect(
      within(pages).queryByRole("option", { name: "Einstellungen" }),
    ).not.toBeInTheDocument();
    expect(mockSearchSchool).not.toHaveBeenCalled();
  });

  it("finds the Mitarbeitende page by its former name", async () => {
    signIn(["users:read"]);
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    await typeQuery("Mitarbeiter");
    const pages = screen.getByRole("group", { name: "Seiten" });
    expect(
      within(pages).getByRole("option", { name: "Mitarbeitende" }),
    ).toBeInTheDocument();
  });

  it("offers no own time, shift plan or calendar without a staff profile (#7306)", () => {
    ownStaff.present = false;
    try {
      signIn(["time_tracking:own", "calendar:own", "users:read"]);
      render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
      const pages = screen.getByRole("group", { name: "Seiten" });
      // Anker: andere Seiten bleiben auffindbar.
      expect(
        within(pages).getByRole("option", { name: "Alle Kinder" }),
      ).toBeInTheDocument();
      for (const name of [
        "Zeiterfassung",
        "Mein Dienstplan",
        "Mein Kalender",
      ]) {
        expect(
          within(pages).queryByRole("option", { name }),
        ).not.toBeInTheDocument();
      }
    } finally {
      ownStaff.present = true;
    }
  });

  it("finds the family behind a phone number and opens the child's contacts", async () => {
    signIn(["users:read"]);
    const onClose = vi.fn();
    mockSearchSchool.mockResolvedValue({
      ...EMPTY,
      contacts: [
        {
          id: "21",
          firstName: "Sabine",
          lastName: "Sonnenberg",
          match: { field: "phone", text: "+49 170 1234567" },
          children: [
            {
              id: "11",
              firstName: "Mia",
              lastName: "Sonnenberg",
              schoolClass: "3a",
              relationshipType: "parent",
            },
          ],
        },
      ],
    });
    render(<SchoolSearchDialog isOpen onClose={onClose} />);

    const user = await typeQuery("  0170 1234567 ");
    await screen.findByRole("option", {
      name: "Sabine Sonnenberg, +49 170 1234567, Elternteil von Mia Sonnenberg (Klasse 3a)",
    });
    expect(mockSearchSchool).toHaveBeenLastCalledWith("0170 1234567");
    // The typed text never lands in a URL (ADR 0231).
    expect(document.querySelector('a[href*="0170"]')).toBeNull();

    await user.keyboard("{Enter}");
    expect(mockPush).toHaveBeenCalledWith(
      "/students/11?tab=erziehungsberechtigte",
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the matched part of a note and opens the child's notes", async () => {
    signIn(["users:read"]);
    const onClose = vi.fn();
    mockSearchSchool.mockResolvedValue({
      ...EMPTY,
      children: [
        {
          ...child("31", "Romy", "Becker"),
          groupName: "Füchse",
          match: {
            field: "student_note",
            text: "… Beim Ausflug zum Zoo hatte sie Heimweh. …",
          },
        },
      ],
    });
    render(<SchoolSearchDialog isOpen onClose={onClose} />);

    const user = await typeQuery("Zoo");
    await screen.findByRole("option", {
      name: "Romy Becker, Klasse 3a · Gruppe Füchse · Notiz: … Beim Ausflug zum Zoo hatte sie Heimweh. …",
    });
    await user.keyboard("{Enter}");
    expect(mockPush).toHaveBeenCalledWith("/students/31?tab=notizen");
    expect(onClose).toHaveBeenCalled();
  });

  it("says why a phone number finds nothing without contact access", async () => {
    // The session holds users:read, but the server grants no contacts (no
    // staff record): the hint follows the server.
    signIn(["users:read"]);
    mockSearchSchool.mockResolvedValue({
      ...EMPTY,
      scope: { ...FULL_SCOPE, contacts: false, childDetails: false },
    });
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    await typeQuery("0170 1234567");
    expect(
      await screen.findByText(
        "Telefonnummern finden nur Konten, die Kontaktdaten sehen dürfen.",
      ),
    ).toBeInTheDocument();
  });

  it("names the registration question and answer of a child", async () => {
    signIn(["users:read"]);
    mockSearchSchool.mockResolvedValue({
      ...EMPTY,
      children: [
        {
          id: "11",
          firstName: "Mia",
          lastName: "Sonnenberg",
          schoolClass: "3a",
          groupName: "Füchse",
          match: {
            field: "enrollment_answer",
            label: "Seepferdchen vorhanden?",
            text: "Ja",
          },
        },
      ],
    });
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    await typeQuery("seepferd");
    expect(
      await screen.findByRole("option", {
        name: "Mia Sonnenberg, Klasse 3a · Gruppe Füchse · Anmeldung: Seepferdchen vorhanden: Ja",
      }),
    ).toBeInTheDocument();
    expect(document.querySelector('a[href*="seepferd"]')).toBeNull();
  });

  it("opens the hit of the typed text, never one of the text before", async () => {
    signIn(["users:read"]);
    const onClose = vi.fn();
    mockSearchSchool.mockResolvedValueOnce({
      ...EMPTY,
      children: [child("11", "Mia", "Mühle")],
    });
    render(<SchoolSearchDialog isOpen onClose={onClose} />);
    const user = await typeQuery("Mü");
    await screen.findByRole("option", { name: /Mia Mühle/ });

    let answer: (result: SchoolSearchResult) => void = () => undefined;
    mockSearchSchool.mockImplementationOnce(
      () =>
        new Promise<SchoolSearchResult>((resolve) => {
          answer = resolve;
        }),
    );
    await user.type(screen.getByRole("combobox"), "ller{Enter}");
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(mockSearchSchool).toHaveBeenLastCalledWith("Müller");
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      answer({ ...EMPTY, children: [child("12", "Ole", "Müller")] });
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/students/12");
  });

  it("names what this account can find from the server's scope", async () => {
    signIn(["users:read"]);
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    expect(
      screen.getByText("Ab 2 Zeichen sucht moto in der Schule."),
    ).toBeInTheDocument();

    await typeQuery("Mia");
    expect(
      await screen.findByText(
        "Auch Telefonnummern, Notizen, Anmeldeangaben und Mitarbeitende",
      ),
    ).toBeInTheDocument();
  });

  it("names no phone numbers for an account the server gives no contacts", async () => {
    signIn(["users:read"]);
    mockSearchSchool.mockResolvedValue({
      ...EMPTY,
      scope: {
        ...FULL_SCOPE,
        contacts: false,
        childDetails: false,
        staff: false,
      },
    });
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    await typeQuery("Mia");
    expect(
      await screen.findByText(
        "Kinder, Räume, Gruppen, Seiten, Einstellungen und Hilfe",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Telefonnummern/)).not.toBeInTheDocument();
  });

  it("shows a failed search even when pages match the text", async () => {
    signIn(["users:read"]);
    loadError.current = { message: "Die Suche konnte nicht geladen werden." };
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    await typeQuery("Alle");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Die Suche konnte nicht geladen werden.",
    );
    expect(
      screen.queryByRole("option", { name: "Alle Kinder" }),
    ).not.toBeInTheDocument();
  });

  it("finds a sub-page of a section and names where it stands", async () => {
    signIn(["admin:*"]);
    const onClose = vi.fn();
    render(<SchoolSearchDialog isOpen onClose={onClose} />);
    // Without input only the pages with their own entry stand there.
    expect(
      screen.queryByRole("option", { name: /Kinderdaten/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Alle Kinder" }),
    ).toBeInTheDocument();

    const user = await typeQuery("kinderdat");
    const pages = screen.getByRole("group", { name: "Seiten" });
    within(pages).getByRole("option", {
      name: "Kinderdaten, Datenverwaltung",
    });
    await user.keyboard("{Enter}");
    expect(mockPush).toHaveBeenCalledWith("/database/students");
  });

  it("finds a single setting and opens it marked in its area", async () => {
    signIn(["config:manage"]);
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    const user = await typeQuery("aufbewahrung");
    const settings = screen.getByRole("group", { name: "Einstellungen" });
    await user.click(
      within(settings).getByRole("option", {
        name: "Aufbewahrungsfrist, Datenschutz · Automatisch löschen",
      }),
    );
    expect(mockPush).toHaveBeenCalledWith(
      "/settings?tab=gdpr&highlight=gdpr.retention_days",
    );
  });

  it("loads no school settings for an account that may not read them", async () => {
    signIn(["users:read"]);
    render(<SchoolSearchDialog isOpen onClose={vi.fn()} />);
    expect(mockUseSettingsSchema).toHaveBeenCalledWith(false);
    await typeQuery("passw");
    // The own profile is searchable for everybody.
    const settings = screen.getByRole("group", { name: "Einstellungen" });
    expect(
      within(settings).getByRole("option", { name: "Passwort, Mein Profil" }),
    ).toBeInTheDocument();
    expect(
      within(settings).queryByRole("option", { name: /Datenschutz/ }),
    ).not.toBeInTheDocument();
  });
});
