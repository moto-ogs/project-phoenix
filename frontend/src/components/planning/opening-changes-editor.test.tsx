import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpeningChange } from "~/lib/opening-change-api";

const { mockList, mockCreate, mockDelete, mockToastSuccess } = vi.hoisted(
  () => ({
    mockList: vi.fn(),
    mockCreate: vi.fn(),
    mockDelete: vi.fn(),
    mockToastSuccess: vi.fn(),
  }),
);

vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "1", permissions: ["schedules:manage"] } },
    status: "authenticated",
  }),
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({ success: mockToastSuccess, error: vi.fn() }),
}));

vi.mock("~/lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock("~/lib/opening-change-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/opening-change-api")>()),
  openingChangeService: {
    list: mockList,
    create: mockCreate,
    delete: mockDelete,
  },
}));

import { SWRConfig } from "~/lib/swr/testing";
import { OpeningChangesEditor as Editor } from "./opening-changes-editor";

function OpeningChangesEditor() {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <Editor />
    </SWRConfig>
  );
}

function makeChange(overrides: Partial<OpeningChange> = {}): OpeningChange {
  return {
    id: "7",
    startDate: "2027-01-29",
    endDate: "2027-01-29",
    opensAt: "07:30",
    closesAt: "12:00",
    reason: "Zeugnisausgabe",
    version: "v1",
    ...overrides,
  };
}

describe("OpeningChangesEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("zeigt Tag, Uhrzeit und Anlass eines geänderten Tags", async () => {
    mockList.mockResolvedValue([makeChange()]);

    render(<OpeningChangesEditor />);

    expect(
      (await screen.findAllByText("Zeugnisausgabe"))[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText("29.01.2027")[0]).toBeInTheDocument();
    expect(screen.getAllByText("07:30 bis 12:00 Uhr")[0]).toBeInTheDocument();
    // Ein Tag öffnet kein Bearbeiten im Overlay (bauart/no-edit-overlay).
    fireEvent.click(
      screen.getByRole("button", { name: "Aktionen für Zeugnisausgabe" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Löschen" })).toBeVisible();
  });

  it("liest das Fenster vom letzten Monat bis ein Jahr voraus", async () => {
    mockList.mockResolvedValue([]);

    render(<OpeningChangesEditor />);

    expect(
      await screen.findByText("Keine geänderten Öffnungszeiten"),
    ).toBeInTheDocument();
    const [from, to] = mockList.mock.calls[0] as [string, string];
    const days =
      (new Date(`${to}T12:00:00`).getTime() -
        new Date(`${from}T12:00:00`).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(395);
  });

  it("sendet ohne Tage und Uhrzeiten nichts", async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeChange());

    render(<OpeningChangesEditor />);

    fireEvent.click(await screen.findByRole("button", { name: /Tag anlegen/ }));
    fireEvent.change(screen.getByLabelText("Anlass"), {
      target: { value: " Zeugnisausgabe " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText("Bitte wähle den ersten Tag."),
    ).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("löscht nach Bestätigung und lädt die Liste neu", async () => {
    mockList.mockResolvedValueOnce([makeChange()]).mockResolvedValueOnce([]);
    mockDelete.mockResolvedValue(undefined);

    render(<OpeningChangesEditor />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Aktionen für Zeugnisausgabe",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("7"));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "„Zeugnisausgabe“ ist gelöscht.",
    );
  });
});
