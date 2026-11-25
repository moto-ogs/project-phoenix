import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import type {
  SchoolProofKinds,
  StaffProofList,
} from "~/lib/traeger-staff-proofs-api";

vi.unmock("swr");
const { api, download } = vi.hoisted(() => ({
  api: {
    fetchStaffProofList: vi.fn(),
    fetchSchoolProofKinds: vi.fn(),
    mapSchoolProofKind: vi.fn(),
    downloadStaffProofList: vi.fn(),
    saveStaffProofType: vi.fn(),
  },
  download: vi.fn(),
}));

vi.mock("~/lib/traeger-staff-proofs-api", async (original) => ({
  ...(await original<typeof import("~/lib/traeger-staff-proofs-api")>()),
  ...api,
}));
vi.mock("~/lib/file-download", async (original) => ({
  ...(await original<typeof import("~/lib/file-download")>()),
  downloadBlob: download,
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/nachweise",
  useSearchParams: () => new URLSearchParams(),
}));

import TraegerStaffProofsPage from "./page-content";

const police = {
  id: "7",
  standardKey: "police_certificate",
  name: "Erweitertes Führungszeugnis",
  validityMonths: 60,
  reminderLeadWeeks: 12,
  mandatory: true,
  archived: false,
  policeCertificate: true,
  version: "police-v1",
};
const measles = {
  id: "8",
  standardKey: "measles_protection",
  name: "Masernschutz",
  validityMonths: null,
  reminderLeadWeeks: 8,
  mandatory: true,
  archived: false,
  policeCertificate: false,
  version: "measles-v1",
};

const entry = (
  recordId: string,
  lastName: string,
  typeId: string,
  status: StaffProofList["entries"][number]["status"],
  expiresOn = "",
) => ({
  recordId,
  firstName: "Mira",
  lastName,
  personnelNumber: null,
  schools: ["OGS Nord"],
  typeId,
  typeName: typeId === "7" ? police.name : measles.name,
  status,
  presentedOn: expiresOn ? "2021-11-20" : "",
  expiresOn,
});

const LIST: StaffProofList = {
  today: "2026-09-09",
  types: [police, measles],
  entries: [
    entry("1", "Sommer", "7", "expired", "2026-09-01"),
    entry("2", "Keller", "8", "missing"),
    entry("3", "Berg", "7", "expiring_soon", "2026-10-30"),
    entry("3", "Berg", "8", "valid"),
  ],
  counts: { expired: 1, missing: 1, expiringSoon: 1, valid: 1 },
};

const SCHOOLS: SchoolProofKinds[] = [
  {
    schoolId: "1",
    schoolName: "OGS Nord",
    kinds: [
      {
        schoolTypeId: "41",
        name: "Erweitertes Führungszeugnis",
        proofTypeId: null,
      },
    ],
  },
];

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <TraegerStaffProofsPage />
    </TraegerResourceTestProvider>,
  );
}

describe("TraegerStaffProofsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchStaffProofList.mockResolvedValue(LIST);
    api.fetchSchoolProofKinds.mockResolvedValue(SCHOOLS);
  });

  it("lists what is open first and counts it in the status line", async () => {
    renderPage();
    // Statuszeile: drei Paare ohne Trennpunkt (#7402).
    expect(
      (await screen.findByText("laufen bald ab")).parentElement?.parentElement,
    ).toHaveTextContent("1 abgelaufen, 1 fehlen, 1 laufen bald ab");
    // Der Name öffnet die Akte im Reiter „Nachweise“ (#7414).
    expect(
      screen.getByRole("link", { name: "Sommer, Mira" }).getAttribute("href"),
    ).toMatch(/\/personal\/\d+\?tab=nachweise$/);
    expect(
      screen.getByRole("link", { name: "Keller, Mira" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Abgelaufen").length).toBeGreaterThan(0);
    // „Offen“ is the default: the valid measles proof of Berg stays out.
    expect(screen.queryAllByText("Gültig", { selector: "span" })).toHaveLength(
      0,
    );
    expect(screen.getAllByRole("link", { name: "Berg, Mira" })).toHaveLength(1);
  });

  it("downloads the list from the backend, which logs the access", async () => {
    api.downloadStaffProofList.mockResolvedValue({
      blob: new Blob(["x"]),
      filename: "nachweise-2026-09-09.csv",
    });
    renderPage();
    // #7405: the export is the only head action, so it sits in the page
    // menu under „Herunterladen“, not as a visible button.
    expect(
      screen.queryByRole("button", { name: "Ablaufliste herunterladen" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Weitere Aktionen" })).at(
        -1,
      )!,
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));
    await vi.waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        expect.any(Blob),
        "nachweise-2026-09-09.csv",
      ),
    );
  });

  it("shows the kinds with validity, warning and the mandatory flag", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Nachweisarten" }));
    expect(await screen.findByText("5 Jahre")).toBeInTheDocument();
    expect(screen.getByText("12 Wochen vorher")).toBeInTheDocument();
    expect(screen.getByText("Läuft nicht ab")).toBeInTheDocument();
    // #7405: title and create button sit in the table's own head.
    expect(
      screen.getByRole("heading", { level: 2, name: "Nachweisarten" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Nachweisart anlegen" }),
    );
    expect(await screen.findByLabelText(/Warnung vor Ablauf/)).toHaveValue("8");
  });

  it("explains that a proof type determines how long a proof is valid", () => {
    renderPage();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Erklärung zu Personalnachweise",
      }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Eine Nachweisart legt fest, wie lange ein Nachweis gilt.",
    );
  });

  it("maps a school kind onto a kind of the Träger", async () => {
    api.mapSchoolProofKind.mockResolvedValue([
      {
        ...SCHOOLS[0]!,
        kinds: [{ ...SCHOOLS[0]!.kinds[0]!, proofTypeId: "7" }],
      },
    ]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("tab", { name: "Arten der Schulen" }),
    );
    const card = (
      await screen.findByText("OGS Nord", { selector: "h2" })
    ).closest("section");
    expect(card).not.toBeNull();
    fireEvent.click(
      within(card!).getByRole("combobox", {
        name: "Art des Trägers für Erweitertes Führungszeugnis",
      }),
    );
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Erweitertes Führungszeugnis",
      }),
    );
    fireEvent.click(
      within(card!).getByRole("button", { name: "Zuordnung speichern" }),
    );
    await vi.waitFor(() =>
      expect(api.mapSchoolProofKind).toHaveBeenCalledWith("1", "41", "7"),
    );
  });

  // #7304: the school cards sit in one grid, so the last one keeps its height.
  it("puts the school cards into one grid", async () => {
    api.fetchSchoolProofKinds.mockResolvedValue([
      SCHOOLS[0]!,
      { ...SCHOOLS[0]!, schoolId: "2", schoolName: "OGS Süd" },
    ]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("tab", { name: "Arten der Schulen" }),
    );
    await screen.findByText("OGS Nord", { selector: "h2" });
    const cards = ["OGS Nord", "OGS Süd"].map((name) =>
      screen.getByText(name, { selector: "h2" }).closest("section"),
    );
    const grid = cards[0]?.parentElement;
    expect(grid).toHaveClass("grid");
    for (const card of cards) expect(card?.parentElement).toBe(grid);
  });

  // ADR 0311: a change rests on the kind as the dialog opened on it. A
  // colleague's change since is refused; the dialog shows the stored kind.
  it("keeps the dialog open on the stored kind after a refusal", async () => {
    api.saveStaffProofType.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Nachweisarten" }));
    fireEvent.click(await screen.findByText("Masernschutz"));
    const dialog = await screen.findByRole("dialog");
    const lead = within(dialog).getByLabelText(/Warnung vor Ablauf/);
    expect(lead).toHaveValue("8");
    fireEvent.change(lead, { target: { value: "6" } });
    api.fetchStaffProofList.mockResolvedValue({
      ...LIST,
      types: [
        police,
        { ...measles, reminderLeadWeeks: 10, version: "measles-v2" },
      ],
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Änderungen speichern" }),
    );

    expect(
      await within(dialog).findByText(
        catalogText("general.changed_since_read", "die Nachweisart"),
      ),
    ).toBeInTheDocument();
    expect(api.saveStaffProofType.mock.calls.at(-1)?.[0]).toEqual({
      id: "8",
      version: "measles-v1",
    });
    await vi.waitFor(() =>
      expect(within(dialog).getByLabelText(/Warnung vor Ablauf/)).toHaveValue(
        "10",
      ),
    );

    api.saveStaffProofType.mockResolvedValue({
      ...measles,
      reminderLeadWeeks: 10,
      version: "measles-v3",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Änderungen speichern" }),
    );
    await vi.waitFor(() =>
      expect(api.saveStaffProofType.mock.calls.at(-1)?.[0]).toEqual({
        id: "8",
        version: "measles-v2",
      }),
    );
  });
});
