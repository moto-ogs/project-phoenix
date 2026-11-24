import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type {
  ChildLinkResult,
  ChildLinkRow,
} from "~/lib/traeger-contract-child-links-api";
import TraegerContractChildLinkPage from "./page";

const api = vi.hoisted(() => ({
  previewChildLinks: vi.fn(),
  applyChildLinks: vi.fn(),
}));
vi.mock("~/lib/traeger-contract-child-links-api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: "7" } },
  }),
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/components/ui/tenant-page", () => ({
  TenantPage: ({ children }: { children: ReactNode }) => children,
}));

function row(
  line: number,
  overrides: Partial<ChildLinkRow> = {},
): ChildLinkRow {
  return {
    line,
    status: "ready",
    contractId: String(70 + line),
    studentId: String(10 + line),
    schoolName: "OGS Sonnenhof",
    contract: {
      firstName: "Mia",
      lastName: "Beispiel",
      birthDate: "2018-05-03",
    },
    student: {
      firstName: "Mia",
      lastName: "Beispiel",
      birthDate: "2018-05-03",
    },
    problems: [],
    repeatsLine: null,
    otherContractId: null,
    fingerprint: "",
    ...overrides,
  };
}

function preview(overrides: Partial<ChildLinkResult> = {}): ChildLinkResult {
  return {
    encoding: "utf-8",
    delimiter: ";",
    headers: ["Vertragsnummer", "Kinderakte"],
    columns: { contract: "Vertragsnummer", child: "Kinderakte" },
    unmapped: [],
    fingerprint: "preview-1",
    applied: false,
    counts: { ready: 1, linked: 1, stored: 0, conflict: 1, invalid: 0 },
    rows: [
      row(2),
      row(3, {
        status: "linked",
        contract: { firstName: "Ben", lastName: "Muster", birthDate: null },
      }),
      row(4, {
        status: "conflict",
        contract: {
          firstName: "Lea",
          lastName: "Kraus",
          birthDate: "2018-01-30",
        },
        student: {
          firstName: "Lea",
          lastName: "Kraus",
          birthDate: "2018-01-03",
        },
        problems: [{ field: "child", code: "differs" }],
      }),
    ],
    ...overrides,
  };
}

async function choose(result = preview()) {
  api.previewChildLinks.mockResolvedValueOnce(result);
  render(
    <TraegerResourceTestProvider>
      <TraegerContractChildLinkPage />
    </TraegerResourceTestProvider>,
  );
  fireEvent.change(screen.getByLabelText("Datei wählen"), {
    target: {
      files: [
        new File(["Vertragsnummer;Kinderakte"], "akten.csv", {
          type: "text/csv",
        }),
      ],
    },
  });
  await screen.findByRole("heading", { name: "Spalten zuordnen" });
}

describe("Verträge mit Kinderakten verknüpfen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("opens on the unclear rows, shows both sides and links the confirmed preview", async () => {
    await choose();
    expect(api.previewChildLinks).toHaveBeenCalledWith(
      expect.objectContaining({ columns: null }),
    );
    // The unclear row is the first thing the office sees.
    expect(screen.getByRole("button", { name: "Unklar 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getAllByText("Geburtsdatum weicht ab").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Ben Muster")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Alle 3" }));
    expect(screen.getAllByText("Ben Muster").length).toBeGreaterThan(0);

    api.applyChildLinks.mockResolvedValueOnce(
      preview({
        applied: true,
        counts: { ready: 0, linked: 1, stored: 1, conflict: 1, invalid: 0 },
        rows: [row(2, { status: "stored" }), ...preview().rows.slice(1)],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "1 Vertrag verknüpfen" }),
    );
    await screen.findByRole("heading", { name: "1 Vertrag verknüpft" });
    expect(api.applyChildLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: "preview-1",
        columns: { contract: "Vertragsnummer", child: "Kinderakte" },
      }),
    );
    expect(
      screen.getByText(/1 Vertrag war schon verknüpft, 1 Zeile ist offen/),
    ).toBeInTheDocument();
    // The open rows stay as a work list.
    expect(
      screen.getByRole("button", { name: "Offene Zeilen herunterladen" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Lea Kraus").length).toBeGreaterThan(0);
  });

  it("reads a repeated file as done, with nothing to link", async () => {
    await choose(
      preview({
        counts: { ready: 0, linked: 2, stored: 0, conflict: 0, invalid: 0 },
        rows: [row(2, { status: "linked" }), row(3, { status: "linked" })],
      }),
    );
    expect(
      screen.getByText(
        "Alle Verträge der Datei sind schon verknüpft. Hier ist nichts zu tun.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "0 Verträge verknüpfen" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("asks for the two columns when moto does not know the headers", async () => {
    await choose(
      preview({
        headers: ["Nr", "Akte"],
        columns: { contract: "", child: "" },
        unmapped: ["contract", "child"],
        fingerprint: "",
        rows: [],
        counts: { ready: 0, linked: 0, stored: 0, conflict: 0, invalid: 0 },
      }),
    );
    expect(screen.getAllByText("Bitte eine Spalte wählen.")).toHaveLength(2);
    expect(
      screen.getByText("Ordne beide Spalten zu. Dann zeigt moto die Zeilen."),
    ).toBeInTheDocument();

    api.previewChildLinks.mockResolvedValueOnce(
      preview({
        headers: ["Nr", "Akte"],
        columns: { contract: "Nr", child: "" },
        unmapped: ["child"],
        rows: [],
      }),
    );
    fireEvent.click(screen.getByRole("combobox", { name: /Vertragsnummer/ }));
    fireEvent.click(screen.getByRole("option", { name: "Nr" }));
    await waitFor(() =>
      expect(api.previewChildLinks).toHaveBeenLastCalledWith(
        expect.objectContaining({ columns: { contract: "Nr", child: "" } }),
      ),
    );
  });

  it("reads the file again when the preview changed before the run", async () => {
    await choose();
    api.applyChildLinks.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.child_link_changed",
      }),
    );
    api.previewChildLinks.mockResolvedValueOnce(
      preview({ fingerprint: "preview-2" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "1 Vertrag verknüpfen" }),
    );
    await waitFor(() => expect(api.previewChildLinks).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", { name: "Prüfen und verknüpfen" }),
    ).toBeInTheDocument();
  });

  it("refuses a file that is no CSV before reading it", async () => {
    render(
      <TraegerResourceTestProvider>
        <TraegerContractChildLinkPage />
      </TraegerResourceTestProvider>,
    );
    fireEvent.change(screen.getByLabelText("Datei wählen"), {
      target: { files: [new File(["x"], "akten.xlsx")] },
    });
    expect(
      await screen.findByText(
        "Bitte wähle eine CSV-Datei. Eine Excel-Datei speichere vorher als CSV.",
      ),
    ).toBeInTheDocument();
    expect(api.previewChildLinks).not.toHaveBeenCalled();
  });
});
