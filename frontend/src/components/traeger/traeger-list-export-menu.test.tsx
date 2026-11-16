import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockShow, mockDownloadBlob } = vi.hoisted(() => ({
  mockShow: vi.fn(),
  mockDownloadBlob: vi.fn(),
}));

vi.mock("~/contexts/ToastContext", () => ({
  useApiErrorDisplay: () => ({ show: mockShow }),
}));
vi.mock("~/lib/file-download", () => ({ downloadBlob: mockDownloadBlob }));

import {
  TraegerListExportMenu,
  traegerExportScope,
} from "./traeger-list-export-menu";

function openMenu() {
  fireEvent.click(
    screen.getByRole("button", { name: "Belegung herunterladen" }),
  );
}

describe("TraegerListExportMenu (#4718)", () => {
  beforeEach(() => {
    mockShow.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("names the schools of the file and offers PDF, Excel and CSV", async () => {
    const download = vi.fn().mockResolvedValue({
      blob: new Blob(["%PDF"]),
      filename: "belegung-2026-09-09.pdf",
    });
    render(
      <TraegerListExportMenu
        download={download}
        scope={traegerExportScope("OGS Am Bach")}
        ariaLabel="Belegung herunterladen"
        fallbackName="belegung"
        errorObject="die Belegung"
      />,
    );
    openMenu();
    expect(await screen.findByText("Nur OGS Am Bach")).toBeInTheDocument();
    expect(screen.getByText("Zum Drucken und Ablegen")).toBeInTheDocument();
    expect(
      screen.getByText("Zum Weiterrechnen in einer Tabelle"),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "CSV" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "PDF" }));
    await vi.waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "belegung-2026-09-09.pdf",
      ),
    );
    expect(download).toHaveBeenCalledWith("pdf");
  });

  it("names the file itself when the backend names none", async () => {
    const download = vi
      .fn()
      .mockResolvedValue({ blob: new Blob(["x"]), filename: null });
    render(
      <TraegerListExportMenu
        download={download}
        scope={traegerExportScope(null)}
        ariaLabel="Belegung herunterladen"
        fallbackName="belegung"
        errorObject="die Belegung"
      />,
    );
    openMenu();
    expect(await screen.findByText("Alle Schulen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Excel" }));
    await vi.waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "belegung.xlsx",
      ),
    );
  });

  it("tells the page and the person about a failed download", async () => {
    const failure = new Error("refused");
    const onError = vi.fn();
    render(
      <TraegerListExportMenu
        download={vi.fn().mockRejectedValue(failure)}
        scope="Alle Schulen"
        ariaLabel="Belegung herunterladen"
        fallbackName="belegung"
        errorObject="die Belegung"
        onError={onError}
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "CSV" }));
    await vi.waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(failure, {
        object: "die Belegung",
      }),
    );
    expect(onError).toHaveBeenCalledWith(failure);
    expect(mockDownloadBlob).not.toHaveBeenCalled();
  });
});
