import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeExportPanel } from "./time-export-panel";

vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

function renderPanel() {
  render(
    <TimeExportPanel
      report={{
        year: 2026,
        month: 10,
        people: 2,
        schools: 1,
        rows: 4,
        withoutNumber: [],
      }}
      monthLabel="Oktober 2026"
      onDownload={vi.fn()}
      downloading={false}
    />,
  );
  expect(screen.getByText("Spalten der Datei")).toBeInTheDocument();
  const [columns] = screen.getAllByRole("list");
  if (!columns) throw new Error("no column list");
  return columns;
}

function columnRow(list: HTMLElement, name: string) {
  const code = within(list).getByText(name, { selector: "code" });
  const row = code.closest("li");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("TimeExportPanel columns (#8126)", () => {
  it("says one line per person, day and school", () => {
    renderPanel();
    expect(
      screen.getByText(/Eine Zeile pro Person, Tag und Schule\./),
    ).toBeInTheDocument();
  });

  it("lists all eleven columns in file order without leading articles", () => {
    const list = renderPanel();
    const rows = Array.from(list.querySelectorAll(":scope > li"));
    expect(
      rows.map((row) => row.querySelector(":scope > code")?.textContent),
    ).toEqual([
      "Personalnummer",
      "Nachname",
      "Vorname",
      "Datum",
      "Einsatzort",
      "Beginn",
      "Ende",
      "Pause_Minuten",
      "Ist_Minuten",
      "Abwesenheit",
      "Abwesenheitsart",
    ]);
    for (const row of rows) {
      const meaning = row.querySelector("[data-column-meaning]")?.textContent;
      expect(meaning).toBeTruthy();
      expect(meaning).not.toMatch(/^(Der|Die|Das|Ein|Eine) /);
    }
  });

  it("names the person, not „jemand“, for a running shift", () => {
    const list = renderPanel();
    expect(columnRow(list, "Ende")).toHaveTextContent(
      "Leer, solange die Person noch arbeitet.",
    );
    expect(list).not.toHaveTextContent(/jemand/);
  });

  it("explains what a gap in the break minutes is", () => {
    const list = renderPanel();
    expect(columnRow(list, "Pause_Minuten")).toHaveTextContent(
      "Eine Lücke ist die Zeit zwischen Ausstempeln und dem nächsten Einstempeln.",
    );
  });

  it("shows the absence codes as a code-to-meaning list", () => {
    const list = renderPanel();
    const row = columnRow(list, "Abwesenheit");
    const codes = within(row).getByRole("list", {
      name: "Codes der Spalte Abwesenheit",
    });
    expect(
      within(codes)
        .getAllByRole("listitem")
        .map((item) => [
          item.querySelector("code")?.textContent,
          item.querySelector("span")?.textContent,
        ]),
    ).toEqual([
      ["vacation", "Urlaub"],
      ["sick", "Krank"],
      ["training", "Fortbildung"],
      ["comp_time", "Freizeitausgleich"],
      ["other", "Sonstige Abwesenheit"],
    ]);
  });
});
