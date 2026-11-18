import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { NumberRange } from "~/lib/traeger-billing-api";
import { testClockDay } from "~/test/clock";

const api = vi.hoisted(() => ({
  saveHolidayNumberRangeStart: vi.fn(),
  saveCareNumberRangeStart: vi.fn(),
}));

vi.mock("~/lib/traeger-billing-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveHolidayNumberRangeStart: api.saveHolidayNumberRangeStart,
  saveCareNumberRangeStart: api.saveCareNumberRangeStart,
}));

import { exportedAtLabel } from "./finance-export-format";
import { NumberRangeCard } from "./number-range-card";

const FRESH: NumberRange = {
  service: "holiday",
  pattern: "{N}",
  example: "1",
  nextNumber: 1,
  lastNumber: 0,
  year: 0,
  starts: [],
};

const RUNNING: NumberRange = {
  service: "holiday",
  pattern: "FE-{JJJJ}-{NNNN}",
  example: "FE-2026-0242",
  nextNumber: 242,
  lastNumber: 241,
  year: 2026,
  starts: [
    {
      nextNumber: 240,
      example: "FE-2026-0240",
      setAt: `${testClockDay(-1)}T08:15:00Z`,
      setByYou: false,
      setByAccount: true,
      setByName: "Ute Beispiel",
    },
    {
      nextNumber: 100,
      example: "FE-2026-0100",
      setAt: `${testClockDay(-2)}T08:15:00Z`,
      setByYou: true,
      setByAccount: true,
      setByName: "",
    },
  ],
};

function renderCard(
  numberRange: NumberRange,
  onChanged = vi.fn().mockResolvedValue(undefined),
  service: "holiday" | "care" = "holiday",
) {
  render(
    <NumberRangeCard
      numberRange={numberRange}
      onChanged={onChanged}
      service={service}
    />,
    { wrapper: ToastProvider },
  );
  return onChanged;
}

async function openStart() {
  fireEvent.click(
    screen.getByRole("button", { name: "Nächste Nummer ändern" }),
  );
  return screen.findByLabelText("Laufende Nummer der nächsten Rechnung");
}

describe("NumberRangeCard: the next number (#7358)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the first number before any invoice and no history", () => {
    renderCard(FRESH);

    expect(screen.getByText("Erste Nummer")).toBeInTheDocument();
    expect(screen.getByText("Noch keine Rechnung")).toBeInTheDocument();
    expect(screen.getByText("Rechnungsnummern der Ferien")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Verlauf ansehen/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the next invoice number and the last issued sequence", () => {
    renderCard(RUNNING);

    expect(screen.getByText("Nächste Nummer 2026")).toBeInTheDocument();
    expect(screen.getByText("FE-2026-0242")).toBeInTheDocument();
    expect(screen.getByText("Letzte laufende Nummer")).toBeInTheDocument();
    expect(screen.getByText("241")).toBeInTheDocument();
  });

  it("does not reconstruct an issued number with a changed pattern", async () => {
    renderCard({
      ...RUNNING,
      pattern: "NEW-{JJJJ}-{NNNN}",
      example: "NEW-2026-0242",
    });

    expect(screen.getByText("NEW-2026-0242")).toBeInTheDocument();
    expect(screen.getByText("241")).toBeInTheDocument();
    expect(screen.queryByText("NEW-2026-0241")).not.toBeInTheDocument();

    await openStart();
    expect(
      screen.getByText(
        "Die letzte laufende Nummer ist 241. Die neue Nummer muss größer sein.",
      ),
    ).toBeInTheDocument();
  });

  it("offers the next number only once the pattern is set", () => {
    renderCard({ ...FRESH, pattern: "", example: "", nextNumber: 0 });

    expect(
      screen.getByRole("button", { name: "Muster festlegen" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nächste Nummer ändern" }),
    ).not.toBeInTheDocument();
  });

  it("lists every change with value, time and person", () => {
    renderCard(RUNNING);

    fireEvent.click(
      screen.getByRole("button", { name: "Verlauf ansehen (2)" }),
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("FE-2026-0240");
    expect(rows[0]).toHaveTextContent("von Ute Beispiel");
    // The test clock moves across summer and winter time.
    expect(rows[0]).toHaveTextContent(
      exportedAtLabel(RUNNING.starts[0]!.setAt),
    );
    expect(rows[1]).toHaveTextContent("FE-2026-0100");
    expect(rows[1]).toHaveTextContent("von dir");
  });

  it("previews the number and saves the start value", async () => {
    api.saveHolidayNumberRangeStart.mockResolvedValue(undefined);
    const onChanged = renderCard(FRESH);

    const field = await openStart();
    expect(field).toHaveValue("1");
    expect(screen.getByRole("button", { name: "Speichern" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.change(field, { target: { value: "7100" } });
    expect(screen.getByText("7100")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.saveHolidayNumberRangeStart).toHaveBeenCalledWith(7100),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(api.saveCareNumberRangeStart).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Die nächste Nummer ist gespeichert."),
    ).toBeInTheDocument();
  });

  it("saves the start of the monthly range through its own route", async () => {
    api.saveCareNumberRangeStart.mockResolvedValue(undefined);
    renderCard({ ...FRESH, service: "care" }, undefined, "care");

    fireEvent.change(await openStart(), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.saveCareNumberRangeStart).toHaveBeenCalledWith(55),
    );
    expect(api.saveHolidayNumberRangeStart).not.toHaveBeenCalled();
  });

  it("refuses a number that is not above the last issued one", async () => {
    renderCard(RUNNING);

    const field = await openStart();
    expect(
      screen.getByText(
        "Die letzte laufende Nummer ist 241. Die neue Nummer muss größer sein.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "241" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        "Die letzte laufende Nummer ist 241. Bitte gib eine größere Nummer ein.",
      ),
    ).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    // The preview promises no number that will not be given.
    expect(screen.getByText("–")).toBeInTheDocument();
    expect(api.saveHolidayNumberRangeStart).not.toHaveBeenCalled();
  });

  it("refuses anything that is no whole number from 1", async () => {
    renderCard(FRESH);

    const field = await openStart();
    for (const value of ["0", "12a", "", "7,5"]) {
      fireEvent.change(field, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      expect(
        await screen.findByText(
          "Bitte gib eine ganze Zahl von 1 bis 99999999 ein.",
        ),
      ).toBeInTheDocument();
    }
    expect(api.saveHolidayNumberRangeStart).not.toHaveBeenCalled();
  });

  it("says that a yearly range starts again next year", async () => {
    renderCard(RUNNING);

    await openStart();
    expect(
      screen.getByText(/Die Nummer gilt für 2026\. Im nächsten Jahr beginnt/),
    ).toBeInTheDocument();
  });

  it("shows the refusal of the backend with the last issued number", async () => {
    api.saveHolidayNumberRangeStart.mockRejectedValue(
      new ApiError("taken", 409, {
        code: "parent_billing.number_range_start_taken",
        details: { last_number: "FE-2026-0250", last_sequence: 250 },
      }),
    );
    const onChanged = renderCard(RUNNING);

    fireEvent.change(await openStart(), { target: { value: "245" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        "Diese Nummer ist zu klein. Die letzte laufende Nummer ist 250. Bitte gib eine größere Nummer ein.",
      ),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
