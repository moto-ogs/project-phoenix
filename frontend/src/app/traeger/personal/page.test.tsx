import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "~/test/helpers/form-modal-pending";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { StaffLinkModal } from "~/components/traeger/staff/staff-link-modal";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type {
  StaffLinkPreview,
  StaffOverview,
  StaffRecordDetail,
} from "~/lib/traeger-staff-api";
import { DESKTOP_WIDTH, setViewportWidth } from "~/test/helpers/viewport";

vi.unmock("swr");

const { api, mockPush, mockReplace, address } = vi.hoisted(() => ({
  api: {
    fetchStaffOverview: vi.fn(),
    previewStaffLink: vi.fn(),
    linkStaff: vi.fn(),
  },
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  address: { search: "" },
}));

vi.mock("~/lib/traeger-staff-api", async (original) => ({
  ...(await original<typeof import("~/lib/traeger-staff-api")>()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => "/personal",
  useSearchParams: () => new URLSearchParams(address.search),
}));

import TraegerStaffRecordsPage from "./page";

afterEach(() => setViewportWidth(DESKTOP_WIDTH));

const mira = (schoolId: string, staffId: string, lastName: string) => ({
  schoolId,
  schoolName: schoolId === "1" ? "OGS Nord" : "OGS Süd",
  staffId,
  firstName: "Mira",
  lastName,
  birthday: "",
  personnelNumber: schoolId === "1" ? "70001" : null,
  hasAccount: true,
});

const OVERVIEW: StaffOverview = {
  release: { representation: "agreement", releasedAt: "2026-11-13T09:00:00Z" },
  schools: [
    { id: "1", name: "OGS Nord" },
    { id: "2", name: "OGS Süd" },
  ],
  records: [],
  suggestions: [
    {
      reason: "same_account",
      recordId: null,
      members: [mira("1", "11", "Sommer"), mira("2", "22", "Sommer-Berg")],
    },
    {
      reason: "single",
      recordId: null,
      members: [
        {
          ...mira("2", "33", "Keller"),
          firstName: "Jonas",
          personnelNumber: null,
        },
      ],
    },
  ],
};

const PREVIEW: StaffLinkPreview = {
  record: null,
  fingerprint: "preview-1",
  members: [mira("1", "11", "Sommer"), mira("2", "22", "Sommer-Berg")],
  fields: [
    {
      field: "first_name",
      conflict: false,
      options: [{ source: "1", schoolName: "OGS Nord", value: "Mira" }],
    },
    {
      field: "last_name",
      conflict: true,
      options: [
        { source: "1", schoolName: "OGS Nord", value: "Sommer" },
        { source: "2", schoolName: "OGS Süd", value: "Sommer-Berg" },
      ],
    },
    {
      field: "iban",
      conflict: false,
      options: [{ source: "2", schoolName: "OGS Süd", value: "•••• 3000" }],
    },
  ],
};

const RECORD = {
  id: "5",
  firstName: "Mira",
  lastName: "Sommer-Berg",
} as StaffRecordDetail;

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <TraegerStaffRecordsPage />
    </TraegerResourceTestProvider>,
  );
}

/** „Personal importieren“ steht im Drei-Punkte-Menü des Kopfes (#7415). */
function importEntry() {
  // Die Suchzeile trägt das Menü je Breite einmal; das erste genügt.
  const [menu] = screen.getAllByRole("button", { name: "Weitere Aktionen" });
  fireEvent.click(menu!);
  return screen.getByRole("menuitem", { name: /Personal importieren/ });
}

describe("TraegerStaffRecordsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    address.search = "";
    mockReplace.mockImplementation((url: string) => {
      address.search = url.replace(/^\?/, "");
    });
    api.fetchStaffOverview.mockResolvedValue(OVERVIEW);
    api.previewStaffLink.mockResolvedValue(PREVIEW);
    api.linkStaff.mockResolvedValue(RECORD);
  });

  it("explains the release where the Träger is not released yet", async () => {
    api.fetchStaffOverview.mockResolvedValue({
      ...OVERVIEW,
      release: null,
      suggestions: [],
    });
    renderPage();
    // #7415: die Bauart „Funktion nicht eingeschaltet“ mit dem Satz der
    // Seite und der Bedingung für die Freischaltung.
    expect(
      await screen.findByText("Diese Funktion ist nicht eingeschaltet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Bis zur Freischaltung führt jede Schule ihr Personal selbst\. Das moto-Team schaltet Personal beim Träger frei/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Vorschläge/ })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Person einstellen/ }),
    ).toBeNull();
  });

  it("opens a proposal, asks for the differing value and links the record", async () => {
    renderPage();
    const proposal = await screen.findByText(
      "Gleiches Konto",
      {},
      { timeout: 3000 },
    );
    expect(screen.getByRole("tab", { name: /Vorschläge/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const row = proposal.closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    const dialog = await screen.findByRole("dialog", {
      name: "Personalakte anlegen",
    });
    expect(api.previewStaffLink).toHaveBeenCalledWith({
      recordId: null,
      members: [
        { schoolId: "1", staffId: "11" },
        { schoolId: "2", staffId: "22" },
      ],
      choices: {},
    });
    expect(
      await within(dialog).findByText("Welcher Wert gilt?"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("•••• 3000")).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Akte anlegen" }),
    );
    expect(
      await within(dialog).findByText(
        "Bitte wähle bei jedem Feld, welcher Wert gilt.",
      ),
    ).toBeInTheDocument();
    expect(api.linkStaff).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("radio", { name: /Sommer-Berg/ }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Akte anlegen" }),
    );
    await vi.waitFor(() =>
      expect(api.linkStaff).toHaveBeenCalledWith({
        recordId: null,
        members: [
          { schoolId: "1", staffId: "11" },
          { schoolId: "2", staffId: "22" },
        ],
        choices: { last_name: "2" },
        expectedFingerprint: "preview-1",
      }),
    );
    await vi.waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/personal/5?from=vorschlaege"),
    );
  });

  it("shows the values again when a school changed one since the preview", async () => {
    api.linkStaff.mockRejectedValueOnce(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    renderPage();
    const proposal = await screen.findByText(
      "Gleiches Konto",
      {},
      { timeout: 3000 },
    );
    fireEvent.click(proposal.closest("tr")!);
    const dialog = await screen.findByRole("dialog", {
      name: "Personalakte anlegen",
    });
    await within(dialog).findByText("Welcher Wert gilt?");
    const reads = api.previewStaffLink.mock.calls.length;
    api.previewStaffLink.mockResolvedValue({
      ...PREVIEW,
      fingerprint: "preview-2",
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Sommer-Berg/ }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Akte anlegen" }),
    );

    expect(
      await within(dialog).findByText(
        catalogText("general.changed_since_read", "die Personalakte"),
      ),
    ).toBeInTheDocument();
    // The dialog reads the values again and asks for the choice anew.
    await vi.waitFor(() =>
      expect(api.previewStaffLink.mock.calls.length).toBeGreaterThan(reads),
    );
    expect(
      within(dialog).getByRole("radio", { name: /Sommer-Berg/ }),
    ).not.toBeChecked();
    expect(
      within(dialog).queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("lists the people without a record and keeps the tab in the address", async () => {
    const view = renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Ohne Akte/ }));
    expect(mockReplace).toHaveBeenCalledWith("?tab=ohne-akte", {
      scroll: false,
    });
    // Der Router rendert nach `replace` mit der neuen Adresse neu.
    view.rerender(
      <TraegerResourceTestProvider>
        <TraegerStaffRecordsPage />
      </TraegerResourceTestProvider>,
    );
    expect(await screen.findByText("Jonas Keller")).toBeInTheDocument();
  });

  // #7377: Abbrechen und Zurück einer Unterseite führen auf den Reiter
  // zurück, von dem man kam.
  it("opens the tab from the address and hands it to its sub pages", async () => {
    address.search = "tab=ohne-akte";
    renderPage();
    expect(await screen.findByText("Jonas Keller")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Ohne Akte/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("link", { name: /Person einstellen/ }),
    ).toHaveAttribute("href", "/personal/einstellen?from=ohne-akte");
    expect(importEntry()).toHaveAttribute(
      "href",
      "/personal/import?from=ohne-akte",
    );
  });

  // #7378: „Akte anlegen“ in der Rückfrage beim Einstellen öffnet den
  // Dialog für genau die Person, die es an der Schule schon gibt.
  it("opens „Akte anlegen“ for the person the address names", async () => {
    address.search = "tab=ohne-akte&schule=2&person=33";
    api.previewStaffLink.mockResolvedValue({
      ...PREVIEW,
      members: [{ ...mira("2", "33", "Keller"), firstName: "Jonas" }],
      fields: [],
    });
    renderPage();
    await screen.findByRole("dialog");
    await vi.waitFor(() =>
      expect(api.previewStaffLink).toHaveBeenCalledWith({
        recordId: null,
        members: [{ schoolId: "2", staffId: "33" }],
        choices: {},
      }),
    );
    // The preview of this opening has to be on screen before it is
    // confirmed; the dialog of the loaded preview is queried anew.
    // A locked button carries aria-disabled with its reason (#6643).
    await vi.waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Akte anlegen",
        }),
      ).not.toHaveAttribute("aria-disabled", "true"),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Akte anlegen",
      }),
    );
    await vi.waitFor(() =>
      expect(api.linkStaff).toHaveBeenCalledWith({
        recordId: null,
        members: [{ schoolId: "2", staffId: "33" }],
        choices: {},
        expectedFingerprint: "preview-1",
      }),
    );
    await vi.waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/personal/5?from=ohne-akte"),
    );
    // The address still names the person until the router moves on; the
    // dialog stays closed anyway.
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("drops the person from the address when the dialog closes", async () => {
    address.search = "tab=ohne-akte&schule=2&person=33";
    renderPage();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(mockReplace).toHaveBeenCalledWith("?tab=ohne-akte", {
      scroll: false,
    });
  });

  it("opens the person again when the address names it again", async () => {
    address.search = "tab=ohne-akte&schule=2&person=33";
    const view = renderPage();
    const rerender = () =>
      view.rerender(
        <TraegerResourceTestProvider>
          <TraegerStaffRecordsPage />
        </TraegerResourceTestProvider>,
      );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Abbrechen",
      }),
    );
    rerender();
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    address.search = "tab=ohne-akte&schule=2&person=33";
    rerender();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("ignores a person in the address that is no ID", async () => {
    address.search = "tab=ohne-akte&schule=2&person=../x";
    renderPage();
    expect(await screen.findByText("Jonas Keller")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.previewStaffLink).not.toHaveBeenCalled();
  });

  it("hands the default suggestions tab to its sub pages", async () => {
    renderPage();
    await screen.findByText("Gleiches Konto");
    expect(screen.getByRole("tab", { name: /Vorschläge/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("link", { name: /Person einstellen/ }),
    ).toHaveAttribute("href", "/personal/einstellen?from=vorschlaege");
    expect(importEntry()).toHaveAttribute(
      "href",
      "/personal/import?from=vorschlaege",
    );
  });

  it("hands the default records tab to its sub pages", async () => {
    api.fetchStaffOverview.mockResolvedValue({
      ...OVERVIEW,
      suggestions: [],
      records: [
        {
          id: "5",
          firstName: "Mira",
          lastName: "Sommer",
          birthday: "",
          personnelNumber: null,
          hasFinancial: false,
          employments: [],
        },
      ],
    });
    renderPage();
    const row = (await screen.findByText("Mira Sommer")).closest("tr");
    expect(row).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /Person einstellen/ }),
    ).toHaveAttribute("href", "/personal/einstellen?from=akten");
    expect(importEntry()).toHaveAttribute(
      "href",
      "/personal/import?from=akten",
    );
    fireEvent.click(row!);
    expect(mockPush).toHaveBeenCalledWith("/personal/5?from=akten");
  });

  // #7415: Suche nach Name oder Personalnummer, wie die Personalliste der
  // Schule; ohne Treffer setzt der Leerzustand die Suche zurück.
  it("finds a record by name or personnel number and resets the search", async () => {
    address.search = "tab=akten";
    const record = (id: string, firstName: string, lastName: string) => ({
      id,
      firstName,
      lastName,
      birthday: "",
      personnelNumber: `7000${id}`,
      hasFinancial: false,
      employments: [],
    });
    api.fetchStaffOverview.mockResolvedValue({
      ...OVERVIEW,
      records: [record("5", "Mira", "Sommer"), record("6", "Lena", "Brändt")],
    });
    renderPage();
    expect(await screen.findByText("Mira Sommer")).toBeInTheDocument();
    const [search] = screen.getAllByPlaceholderText("Name oder Nummer suchen…");

    fireEvent.change(search!, { target: { value: "brandt" } });
    await waitFor(() => expect(screen.queryByText("Mira Sommer")).toBeNull());
    expect(screen.getByText("Lena Brändt")).toBeInTheDocument();

    fireEvent.change(search!, { target: { value: "70005" } });
    expect(await screen.findByText("Mira Sommer")).toBeInTheDocument();
    expect(screen.queryByText("Lena Brändt")).toBeNull();

    fireEvent.change(search!, { target: { value: "xyznichts" } });
    expect(await screen.findByText("Kein Treffer.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Filter zurücksetzen" }),
    );
    expect(await screen.findByText("Mira Sommer")).toBeInTheDocument();
    expect(screen.getByText("Lena Brändt")).toBeInTheDocument();
  });

  it("opens a record with the tab it came from", async () => {
    address.search = "tab=akten";
    api.fetchStaffOverview.mockResolvedValue({
      ...OVERVIEW,
      records: [
        {
          id: "5",
          firstName: "Mira",
          lastName: "Sommer",
          birthday: "",
          personnelNumber: null,
          hasFinancial: false,
          employments: [],
        },
      ],
    });
    renderPage();
    const row = (await screen.findByText("Mira Sommer")).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(mockPush).toHaveBeenCalledWith("/personal/5?from=akten");
  });

  it("ignores an unknown tab in the address and uses the default tab", async () => {
    address.search = "tab=unbekannt";
    renderPage();
    expect(await screen.findByText("Gleiches Konto")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Vorschläge/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("link", { name: /Person einstellen/ }),
    ).toHaveAttribute("href", "/personal/einstellen?from=vorschlaege");
  });
});

it("requires a successful fresh link preview on each opening", async () => {
  api.linkStaff.mockReset().mockResolvedValue(RECORD);
  api.previewStaffLink.mockReset().mockResolvedValue({
    ...PREVIEW,
    fields: PREVIEW.fields.map((f) => ({ ...f, conflict: false })),
  });
  const request = {
    recordId: null,
    members: [
      { schoolId: "1", staffId: "11" },
      { schoolId: "2", staffId: "22" },
    ],
  };
  const props = { onClose: vi.fn(), onLinked: vi.fn() };
  const view = render(<StaffLinkModal {...props} request={request} />, {
    wrapper: TraegerResourceTestProvider,
  });
  expect(await screen.findByText("•••• 3000")).toBeVisible();
  view.rerender(<StaffLinkModal {...props} request={null} />);
  const fresh = deferred<StaffLinkPreview>();
  api.previewStaffLink.mockReturnValue(fresh.promise);
  view.rerender(<StaffLinkModal {...props} request={request} />);
  expect(screen.getByRole("button", { name: "Akte anlegen" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Akte anlegen" }));
  expect(api.linkStaff).not.toHaveBeenCalled();
  await act(async () => fresh.reject(new ApiError("offline", 503)));
  expect(
    await screen.findByText(catalogText("general.unavailable", "die Vorschau")),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Akte anlegen" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
