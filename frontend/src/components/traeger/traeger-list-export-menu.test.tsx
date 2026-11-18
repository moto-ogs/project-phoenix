import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockShow, mockDownloadBlob } = vi.hoisted(() => ({
  mockShow: vi.fn(),
  mockDownloadBlob: vi.fn(),
}));

vi.mock("~/contexts/ToastContext", () => ({
  useApiErrorDisplay: () => ({ show: mockShow }),
}));
vi.mock("~/lib/file-download", () => ({ downloadBlob: mockDownloadBlob }));

import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import type { TraegerListFile } from "~/lib/traeger-list-export";

import {
  TraegerListExportMenu,
  traegerExportScope,
  useTraegerListExportItems,
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

/** A page head kebab that carries the export entries next to another action. */
function PageMenu(props: Parameters<typeof useTraegerListExportItems>[0]) {
  const exportItems = useTraegerListExportItems(props);
  return (
    <OverflowMenu
      ariaLabel="Weitere Aktionen"
      items={[
        {
          label: "Schulen verwalten",
          description: "Öffnet die Liste der Schulen.",
          onClick: () => undefined,
        },
        ...exportItems,
      ]}
    />
  );
}

function renderPageMenu(
  overrides: Partial<ComponentProps<typeof PageMenu>> = {},
) {
  return render(
    <PageMenu
      download={vi
        .fn()
        .mockResolvedValue({ blob: new Blob(["x"]), filename: null })}
      scope={traegerExportScope("OGS Am Bach")}
      fallbackName="belegung"
      errorObject="die Belegung"
      {...overrides}
    />,
  );
}

function openPageMenu() {
  fireEvent.click(screen.getByRole("button", { name: /Weitere Aktionen/ }));
}

describe("useTraegerListExportItems (#7403)", () => {
  beforeEach(() => {
    mockShow.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("puts the formats under „Herunterladen“ and names the schools of the file", async () => {
    const download = vi.fn().mockResolvedValue({
      blob: new Blob(["%PDF"]),
      filename: "belegung-2026-09-09.pdf",
    });
    renderPageMenu({ download });
    openPageMenu();
    expect(await screen.findByText("Herunterladen")).toBeInTheDocument();
    expect(screen.getByText("Nur OGS Am Bach")).toBeInTheDocument();
    expect(screen.getByText("Zum Drucken und Ablegen")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Excel/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /CSV/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /PDF/ }));
    await vi.waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "belegung-2026-09-09.pdf",
      ),
    );
    expect(download).toHaveBeenCalledWith("pdf");
  });

  it("names the file itself when the backend names none", async () => {
    renderPageMenu();
    openPageMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Excel/ }));
    await vi.waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "belegung.xlsx",
      ),
    );
  });

  it("holds every format while one file is being created", async () => {
    let finish: (file: TraegerListFile) => void = () => undefined;
    const download = vi.fn(
      () =>
        new Promise<TraegerListFile>((resolve) => {
          finish = resolve;
        }),
    );
    renderPageMenu({ download });
    openPageMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));

    openPageMenu();
    const busyEntry = await screen.findByRole("menuitem", {
      name: /Wird erstellt/,
    });
    expect(busyEntry).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /PDF/ })).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: /Schulen verwalten/ }),
    ).toBeEnabled();

    finish({ blob: new Blob(["x"]), filename: null });
    await vi.waitFor(() =>
      expect(mockDownloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "belegung.csv",
      ),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /PDF/ })).toBeEnabled(),
    );
  });

  it("holds the formats while the data behind them is not there", async () => {
    renderPageMenu({ unavailable: true });
    openPageMenu();
    expect(await screen.findByRole("menuitem", { name: /PDF/ })).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: /Schulen verwalten/ }),
    ).toBeEnabled();
  });

  it("tells the page and the person about a failed download", async () => {
    const failure = new Error("refused");
    const onError = vi.fn();
    renderPageMenu({
      download: vi.fn().mockRejectedValue(failure),
      onError,
    });
    openPageMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/ }));
    await vi.waitFor(() =>
      expect(mockShow).toHaveBeenCalledWith(failure, {
        object: "die Belegung",
      }),
    );
    expect(onError).toHaveBeenCalledWith(failure);
    expect(mockDownloadBlob).not.toHaveBeenCalled();
  });
});
