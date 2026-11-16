import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { StudentParentRecords } from "~/lib/parent-announcements-api";
import { StudentParentRecordsCard } from "./student-parent-records";

const mutate = vi.fn(async () => undefined);
const download = vi.fn();
const swrResult: {
  data: StudentParentRecords | undefined;
  isLoading: boolean;
  error: unknown;
} = { data: undefined, isLoading: false, error: undefined };

vi.mock("~/lib/swr", () => ({
  useSWRAuth: () => ({ ...swrResult, mutate }),
}));

vi.mock("~/lib/parent-announcements-api", () => ({
  fetchStudentParentRecords: vi.fn(),
  downloadDeclarationExport: (...args: unknown[]) =>
    download(...args) as unknown,
}));

const records: StudentParentRecords = {
  letters: [
    {
      announcement_id: "11",
      title: "Laternenfest",
      published_at: "2026-09-01T08:00:00Z",
      can_confirm: true,
      acknowledged_at: "2026-09-02T17:30:00Z",
      acknowledged_by: "Maria Muster",
    },
    {
      announcement_id: "12",
      title: "Betreuungszeiten",
      published_at: "2026-09-03T08:00:00Z",
      can_confirm: false,
      acknowledged_at: null,
      acknowledged_by: "",
    },
  ],
  declarations: [
    {
      announcement_id: "21",
      title: "Zoo-Ausflug",
      published_at: "2026-09-04T08:00:00Z",
      deadline: "2026-09-20T21:59:00Z",
      version_no: 2,
      state: "open",
      signers: [
        {
          account_id: "5",
          first_name: "Maria",
          last_name: "Muster",
          action: null,
          submitted_at: null,
        },
      ],
    },
    {
      announcement_id: "22",
      title: "Fotos",
      published_at: "2026-09-05T08:00:00Z",
      deadline: null,
      version_no: 1,
      state: "agreed",
      signers: [
        {
          account_id: "5",
          first_name: "Maria",
          last_name: "Muster",
          action: "agreed",
          submitted_at: "2026-09-06T10:00:00Z",
        },
      ],
    },
  ],
};

function renderCard() {
  return render(
    <ToastProvider>
      <StudentParentRecordsCard studentId="7" />
    </ToastProvider>,
  );
}

describe("StudentParentRecordsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrResult.data = records;
    swrResult.error = undefined;
    swrResult.isLoading = false;
  });

  it("lists each letter with the child's confirmation and links to the letter", () => {
    renderCard();

    const confirmed = screen.getByText("Laternenfest").closest("li")!;
    expect(within(confirmed).getByText("Bestätigt")).toBeInTheDocument();
    expect(
      within(confirmed).getByText(
        "Verschickt am 01.09.2026 · Bestätigt am 02.09.2026 von Maria Muster",
      ),
    ).toBeInTheDocument();
    expect(
      within(confirmed).getByRole("link", {
        name: "Brief öffnen: Laternenfest",
      }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/parent-announcements/11"),
    );

    const noAccount = screen.getByText("Betreuungszeiten").closest("li")!;
    expect(
      within(noAccount).getByText("Niemand kann bestätigen"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 von 2 bestätigt")).toBeInTheDocument();
  });

  it("shows each declaration's state, answers and deadline", () => {
    renderCard();

    const open = screen.getByText("Zoo-Ausflug").closest("li")!;
    expect(within(open).getByText("Offen")).toBeInTheDocument();
    expect(
      within(open).getByText(
        "Verschickt am 04.09.2026 · Fassung 2 · Antwort bis 20.09.2026",
      ),
    ).toBeInTheDocument();

    const agreed = screen.getByText("Fotos").closest("li")!;
    expect(within(agreed).getByText("Zugestimmt")).toBeInTheDocument();
    expect(
      within(agreed).getByText(
        "Verschickt am 05.09.2026 · Maria Muster hat am 06.09.2026 zugestimmt",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("1 offen")).toBeInTheDocument();
  });

  it("downloads the proof of exactly this child", async () => {
    download.mockResolvedValue(undefined);
    renderCard();

    fireEvent.click(
      screen.getByRole("button", { name: "Nachweis als PDF: Fotos" }),
    );

    await vi.waitFor(() =>
      expect(download).toHaveBeenCalledWith("22", "pdf", undefined, "7"),
    );
  });

  it("names the proof in a toast when the download fails", async () => {
    download.mockRejectedValue(
      new ApiError("forbidden", 403, { code: "general.permission" }),
    );
    renderCard();

    fireEvent.click(
      screen.getByRole("button", { name: "Nachweis als PDF: Fotos" }),
    );

    expect(
      await screen.findByText(
        "Für den Nachweis fehlt Ihnen die Berechtigung. Bitte fragen Sie die Schule.",
      ),
    ).toBeInTheDocument();
  });

  it("says what will appear when nothing was sent yet", () => {
    swrResult.data = { letters: [], declarations: [] };
    renderCard();

    expect(
      screen.getByText("Noch keine Elternbriefe oder Einverständnisse"),
    ).toBeInTheDocument();
    expect(screen.getByText("Aus moto")).toBeInTheDocument();
  });

  it("shows a failed load in place with a retry", async () => {
    swrResult.data = undefined;
    swrResult.error = new ApiError("down", 503, {
      code: "general.unavailable",
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Wiederholen" }));
    expect(mutate).toHaveBeenCalledOnce();
  });
});
