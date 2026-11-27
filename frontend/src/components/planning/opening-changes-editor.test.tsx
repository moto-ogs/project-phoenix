import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpeningChange } from "~/lib/opening-change-api";

const { mockList, mockCreate, mockUpdate, mockDelete, mockToastSuccess } =
  vi.hoisted(() => ({
    mockList: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockToastSuccess: vi.fn(),
  }));

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
    update: mockUpdate,
    delete: mockDelete,
  },
}));

import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { SWRConfig } from "~/lib/swr/testing";
import { OpeningChangeEditCard } from "./opening-change-edit-card";
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
    fromTraeger: false,
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
    fireEvent.click(
      screen.getByRole("button", { name: "Aktionen für Zeugnisausgabe" }),
    );
    expect(screen.getByRole("menuitem", { name: "Bearbeiten" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Löschen" })).toBeVisible();
  });

  it("zeigt einen Tag des Trägers mit „Vom Träger“ und ohne Aktionen (#8202)", async () => {
    mockList.mockResolvedValue([
      makeChange(),
      makeChange({ reason: "Personalversammlung", fromTraeger: true }),
    ]);

    render(<OpeningChangesEditor />);

    expect(
      (await screen.findAllByText("Personalversammlung"))[0],
    ).toBeInTheDocument();
    expect(screen.getAllByText("Vom Träger")[0]).toBeInTheDocument();
    expect(
      screen.getByText(/Ändern kann sie nur das Träger-Büro/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aktionen für Zeugnisausgabe" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Aktionen für Personalversammlung",
      }),
    ).not.toBeInTheDocument();
  });

  it("ändert einen Tag an Ort und Stelle und sendet die gelesene Version (#8173)", async () => {
    mockList.mockResolvedValue([makeChange()]);
    mockUpdate.mockResolvedValue(
      makeChange({ reason: "Zeugnistag", version: "v2" }),
    );

    render(<OpeningChangesEditor />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Aktionen für Zeugnisausgabe",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Bearbeiten" }));
    // Kein Overlay (bauart/no-edit-overlay): die Felder stehen in der Karte.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const reason = screen.getByLabelText("Anlass");
    expect(reason).toHaveValue("Zeugnisausgabe");
    fireEvent.change(reason, { target: { value: " Zeugnistag " } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        "7",
        {
          startDate: "2027-01-29",
          endDate: "2027-01-29",
          opensAt: "07:30",
          closesAt: "12:00",
          reason: "Zeugnistag",
        },
        "v1",
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "„Zeugnistag“ ist gespeichert.",
    );
    expect(
      await screen.findByRole("button", { name: /Tag anlegen/ }),
    ).toBeInTheDocument();
  });

  it("zeigt die gespeicherte Änderung, wenn die Liste danach nicht aktualisiert wird", async () => {
    mockUpdate.mockResolvedValue(
      makeChange({ reason: "Zeugnistag", version: "v2" }),
    );

    render(
      <OpeningChangeEditCard
        change={makeChange()}
        reload={async () => makeChange({ reason: "Zeugnistag", version: "v2" })}
        onStored={async () => {
          throw new Error("unavailable");
        }}
        onClose={vi.fn()}
        minDate="2026-08-10"
        maxDate="2027-09-09"
      />,
    );
    fireEvent.change(screen.getByLabelText("Anlass"), {
      target: { value: "Zeugnistag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Änderung ist gespeichert. Lade die Liste neu.",
    );
    expect(
      screen.getByRole("button", { name: "Liste neu laden" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Speichern" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Speichert…" })).toBeNull();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("zeigt nach einer Änderung von anderer Seite den gespeicherten Tag (ADR 0311)", async () => {
    mockList.mockResolvedValueOnce([makeChange()]).mockResolvedValue([
      // The Träger and school sequences are independent, so this matching
      // ID must not replace the school day being edited.
      makeChange({
        reason: "Personalversammlung",
        version: "traeger-v2",
        fromTraeger: true,
      }),
      makeChange({ reason: "Elternabend", version: "v2" }),
    ]);
    mockUpdate.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );

    render(<OpeningChangesEditor />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Aktionen für Zeugnisausgabe",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Bearbeiten" }));
    fireEvent.change(screen.getByLabelText("Anlass"), {
      target: { value: "Zeugnistag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Anlass")).toHaveValue("Elternabend"),
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        catalogText(
          "general.changed_since_read",
          "das Speichern der geänderten Öffnungszeit",
        ),
      ),
    ).toBeInTheDocument();
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
