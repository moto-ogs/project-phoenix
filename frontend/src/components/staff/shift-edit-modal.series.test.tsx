import {
  act,
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { SWRConfig, useSWRConfig } from "~/lib/swr/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import { setTestClock } from "~/test/clock";
import { catalogText } from "~/test/error-catalog-text";

import { ShiftEditModal } from "./shift-edit-modal";
import type { CalendarPeriod } from "~/lib/calendar-period-helpers";
import type { StaffShift } from "~/lib/shift-helpers";

vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1" }, expires: "2099-01-01" },
  }),
}));

// Real SWR with a fresh cache per render: the modal reads calendar periods
// and the series rule through the shared cache.
function FreshCache({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

function render(ui: ReactElement) {
  return renderUi(ui, { wrapper: FreshCache });
}

// Stands in for the plan reload after a colleague's change: every read in
// the cache revalidates, the series rule included.
let revalidateAll: () => Promise<unknown> = () => Promise.resolve();
function CacheHandle() {
  const { mutate } = useSWRConfig();
  revalidateAll = () => mutate(() => true);
  return null;
}

const createSeries = vi.fn();
const splitSeries = vi.fn();
const endSeries = vi.fn();
const getSeries = vi.fn();
const updateShift = vi.fn();
const deleteShift = vi.fn();
const listPeriods = vi.fn();
const mockDatePickerValue = vi.hoisted(() => ({
  value: new Date(2026, 11, 31),
}));

vi.mock("~/lib/shift-api", () => ({
  staffShiftService: {
    createShift: vi.fn(),
    updateShift: (...args: unknown[]) => updateShift(...args) as unknown,
    deleteShift: (...args: unknown[]) => deleteShift(...args) as unknown,
    applyCancellation: vi.fn(),
  },
  staffShiftSeriesService: {
    createSeries: (...args: unknown[]) => createSeries(...args) as unknown,
    splitSeries: (...args: unknown[]) => splitSeries(...args) as unknown,
    endSeries: (...args: unknown[]) => endSeries(...args) as unknown,
    // Opening a series shift now also loads the rule behind it (#2028); the
    // mock must cover the whole module surface the modal touches.
    getSeries: (...args: unknown[]) => getSeries(...args) as unknown,
  },
}));

vi.mock("~/lib/calendar-period-api", () => ({
  calendarPeriodService: {
    list: (...args: unknown[]) => listPeriods(...args) as unknown,
  },
}));

// The kit DatePicker opens a react-day-picker calendar overlay; drive its
// onChange directly instead (same pattern as planned-status-days-modal.test).
vi.mock("~/components/ui/date-picker", () => ({
  DatePicker: ({ onChange }: { onChange: (date: Date | null) => void }) => (
    <button type="button" onClick={() => onChange(mockDatePickerValue.value)}>
      DatePicker Auswahl
    </button>
  ),
}));

const halbjahr: CalendarPeriod = {
  id: "5",
  name: "1. Halbjahr 2026/27",
  periodType: "semester",
  startDate: "2026-08-01",
  endDate: "2027-01-31",
  weekCycleLength: 2,
  weekCycleAnchor: "2026-08-03",
  isActive: true,
} as CalendarPeriod;

const ganzjahrOhneZyklus: CalendarPeriod = {
  id: "6",
  name: "Ganzjahr ohne Zyklus",
  periodType: "school_year",
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  weekCycleLength: 1,
  weekCycleAnchor: null,
  isActive: true,
} as CalendarPeriod;

const halbjahrVersetzt: CalendarPeriod = {
  ...halbjahr,
  id: "7",
  name: "Versetzter A/B-Zyklus",
  weekCycleAnchor: "2026-08-10",
} as CalendarPeriod;

const seriesShift: StaffShift = {
  id: "9",
  staffId: "7",
  date: "2026-09-07",
  startTime: "08:00",
  endTime: "12:00",
  breakMinutes: 0,
  shiftTypeId: null,
  shiftTypeName: null,
  shiftTypeColor: null,
  notes: "",
  seriesId: "5",
  detached: false,
  cancelled: false,
  changeReason: null,
  originShiftId: null,
  version: "occurrence-v1",
};

// The series rule loads asynchronously and the button stays disabled until
// it has; a click before that is ignored.
async function openSeriesEditor() {
  const editSeries = await screen.findByRole("button", {
    name: "Serie bearbeiten",
  });
  await waitFor(() => expect(editSeries).toBeEnabled());
  fireEvent.click(editSeries);
}

function renderModal(props: Partial<Parameters<typeof ShiftEditModal>[0]>) {
  return render(
    <ShiftEditModal
      mode="create"
      staffId="7"
      staffName="Ada Lovelace"
      date="2026-09-07"
      shift={null}
      shiftTypes={[]}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      {...props}
    />,
  );
}

const seriesRule = {
  id: "5",
  staffId: "7",
  weekdays: [1, 3],
  startTime: "08:00",
  endTime: "12:00",
  breakMinutes: 0,
  shiftTypeId: null,
  calendarPeriodId: "5",
  weekPattern: 0,
  validFrom: "2026-09-01",
  validUntil: null,
  includeSchoolBreaks: false,
  version: "series-v1",
};

beforeEach(() => {
  // Periods, shifts and the picked end date are a fixed school year around
  // Wednesday 2026-09-09; edits apply from today on.
  setTestClock("2026-09-09T12:00:00+02:00");
  vi.clearAllMocks();
  mockDatePickerValue.value = new Date(2026, 11, 31);
  listPeriods.mockResolvedValue([halbjahr]);
  getSeries.mockResolvedValue(seriesRule);
});

describe("ShiftEditModal series creation", () => {
  it("shows the repeat section with the clicked weekday preselected", async () => {
    renderModal({});

    fireEvent.click(screen.getByLabelText("Als Serie wiederholen"));

    // 2026-09-07 is a Monday.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mo" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByRole("button", { name: "Di" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(listPeriods).toHaveBeenCalledTimes(1);
  });

  it("creates a weekly series over the selected period", async () => {
    createSeries.mockResolvedValue({
      seriesId: "5",
      created: 20,
      skippedDates: [],
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSaved, onClose });

    fireEvent.click(screen.getByLabelText("Als Serie wiederholen"));
    // The period select defaults asynchronously once the periods loaded.
    await screen.findByText("1. Halbjahr 2026/27");
    fireEvent.click(screen.getByRole("button", { name: "Mi" }));
    expect(screen.getByRole("button", { name: "Mi" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Mo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Serie anlegen" }));

    await waitFor(() => {
      expect(createSeries).toHaveBeenCalledWith({
        staffId: "7",
        weekdays: [1, 3],
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30,
        shiftTypeId: null,
        calendarPeriodId: "5",
        weekPattern: 0,
        validFrom: "2026-09-07",
        validUntil: null,
        includeSchoolBreaks: false,
      });
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // #3820: Ferien und Schließtage lässt die Serie standardmäßig aus; der
  // Haken ersetzt die frühere Schließtag-Rückfrage (#2032).
  it("plans Ferien and closing days only when the box is ticked", async () => {
    createSeries.mockResolvedValue({
      seriesId: "5",
      created: 20,
      skippedDates: [],
      skippedNonWorkingDays: 0,
    });
    renderModal({});

    fireEvent.click(screen.getByLabelText("Als Serie wiederholen"));
    await screen.findByText("1. Halbjahr 2026/27");
    const box = screen.getByLabelText(
      /Auch in den Ferien und an Schließtagen planen/,
    );
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Serie anlegen" }));

    await waitFor(() => {
      expect(createSeries).toHaveBeenCalledWith(
        expect.objectContaining({ includeSchoolBreaks: true }),
      );
    });
    expect(
      screen.queryByRole("dialog", { name: "An einem Schließtag planen?" }),
    ).not.toBeInTheDocument();
  });

  it("says how many days stayed free in the Ferien, on closing days or holidays", async () => {
    createSeries.mockResolvedValue({
      seriesId: "5",
      created: 15,
      skippedDates: [],
      skippedNonWorkingDays: 5,
    });
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByLabelText("Als Serie wiederholen"));
    await screen.findByText("1. Halbjahr 2026/27");
    fireEvent.click(screen.getByRole("button", { name: "Serie anlegen" }));

    expect(
      await screen.findByText(
        "5 Tage liegen in den Ferien, an Schließtagen oder Feiertagen und bleiben frei.",
      ),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("drops a stale A/B pattern when switching to a period without a week cycle", async () => {
    createSeries.mockResolvedValue({
      seriesId: "5",
      created: 20,
      skippedDates: [],
    });
    listPeriods.mockResolvedValue([halbjahr, ganzjahrOhneZyklus]);
    renderModal({});

    fireEvent.click(screen.getByLabelText("Als Serie wiederholen"));
    await screen.findByText("1. Halbjahr 2026/27");
    // Enable A/B on the cycle period, then switch to a period without a
    // cycle: the hidden biweekly flag must not leak into the payload.
    fireEvent.click(screen.getByRole("button", { name: "Alle 2 Wochen" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Kalenderzeitraum" }));
    fireEvent.click(
      screen.getByRole("option", { name: "Ganzjahr ohne Zyklus" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Serie anlegen" }));

    await waitFor(() => {
      expect(createSeries).toHaveBeenCalledWith(
        expect.objectContaining({ calendarPeriodId: "6", weekPattern: 0 }),
      );
    });
  });

  it("keeps an explicitly reselected A week when the period default changes", async () => {
    listPeriods.mockResolvedValue([halbjahr, halbjahrVersetzt]);
    renderModal({ date: "2026-09-14" });

    fireEvent.click(screen.getByLabelText("Als Serie wiederholen"));
    await screen.findByText("1. Halbjahr 2026/27");
    fireEvent.click(screen.getByRole("button", { name: "Alle 2 Wochen" }));

    const weekA = screen.getByRole("button", { name: "Woche A" });
    await waitFor(() => expect(weekA).toHaveAttribute("aria-pressed", "true"));
    // Clicking the active option changes no value. The click still represents
    // an explicit choice and must stop future defaults.
    fireEvent.click(weekA);
    fireEvent.click(screen.getByRole("combobox", { name: "Kalenderzeitraum" }));
    fireEvent.click(
      screen.getByRole("option", { name: "Versetzter A/B-Zyklus" }),
    );

    expect(weekA).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Woche B" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("sends the inclusive 'Gültig bis' date as the exclusive valid_until", async () => {
    createSeries.mockResolvedValue({
      seriesId: "5",
      created: 20,
      skippedDates: [],
    });
    renderModal({});

    fireEvent.click(screen.getByLabelText("Als Serie wiederholen"));
    await screen.findByText("1. Halbjahr 2026/27");
    // The user picks the LAST day that should still have a shift (year
    // boundary on purpose; the DatePicker mock selects 2026-12-31); the
    // API's valid_until is exclusive → +1 day.
    fireEvent.click(screen.getByRole("button", { name: "DatePicker Auswahl" }));
    fireEvent.click(screen.getByRole("button", { name: "Serie anlegen" }));

    await waitFor(() => {
      expect(createSeries).toHaveBeenCalledWith(
        expect.objectContaining({ validUntil: "2027-01-01" }),
      );
    });
  });

  it("keeps the modal open and lists skipped days after a collision", async () => {
    createSeries.mockResolvedValue({
      seriesId: "5",
      created: 19,
      skippedDates: ["2026-09-14", "2026-09-21"],
    });
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByLabelText("Als Serie wiederholen"));
    await screen.findByText("1. Halbjahr 2026/27");
    fireEvent.click(screen.getByRole("button", { name: "Serie anlegen" }));

    await waitFor(() => {
      expect(
        screen.getByText(/wurden übersprungen: 14\.09\.2026, 21\.09\.2026\./),
      ).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ShiftEditModal series scopes", () => {
  it("asks for the edit scope and splits the series for 'Ab jetzt dauerhaft'", async () => {
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 10,
      skippedDates: [],
    });
    renderModal({ mode: "edit", shift: seriesShift });

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    expect(
      screen.getByText(
        "Diese Schicht ist Teil einer Serie. Wofür soll die Änderung gelten?",
      ),
    ).toBeInTheDocument();

    // The split carries the version of the series rule, so the choice waits
    // for it (ADR 0311).
    const following = () =>
      screen.getByRole("button", { name: /Ab jetzt dauerhaft/ });
    await waitFor(() => expect(following()).toBeEnabled());
    fireEvent.click(following());

    await waitFor(() => {
      expect(splitSeries).toHaveBeenCalledWith("5", {
        effectiveDate: "2026-09-07",
        occurrenceShiftId: "9",
        // ADR 0311: a split from today rewrites the opened occurrence.
        expectedOccurrenceVersion: "occurrence-v1",
        startTime: "08:00",
        endTime: "12:00",
        breakMinutes: 0,
        shiftTypeId: null,
        expectedVersion: "series-v1",
      });
    });
    expect(updateShift).not.toHaveBeenCalled();
  });

  it("asks for the delete scope and deletes only this occurrence for 'Nur diese Woche'", async () => {
    deleteShift.mockResolvedValue(undefined);
    renderModal({ mode: "edit", shift: seriesShift });

    fireEvent.click(screen.getByRole("button", { name: "Schicht löschen" }));
    // Scope-Slot der ConfirmDeleteModal (#3110): die Wahl ist der erste
    // Schritt, ohne sie bleibt Löschen gesperrt.
    expect(screen.getByText("Was soll gelöscht werden?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Löschen" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Nur diese Woche/ }));
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));

    await waitFor(() => {
      expect(deleteShift).toHaveBeenCalledWith("9");
    });
    expect(endSeries).not.toHaveBeenCalled();
  });

  it("ends the series from the shift date for 'Ab jetzt dauerhaft' delete", async () => {
    endSeries.mockResolvedValue(undefined);
    renderModal({ mode: "edit", shift: seriesShift });

    fireEvent.click(screen.getByRole("button", { name: "Schicht löschen" }));
    fireEvent.click(screen.getByRole("radio", { name: /Ab jetzt dauerhaft/ }));
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));

    await waitFor(() => {
      expect(endSeries).toHaveBeenCalledWith("5", "2026-09-07");
    });
    expect(deleteShift).not.toHaveBeenCalled();
  });

  it("ends a moved occurrence's series from its original date", async () => {
    endSeries.mockResolvedValue(undefined);
    renderModal({
      mode: "edit",
      shift: {
        ...seriesShift,
        date: "2026-09-08",
        detached: true,
        seriesOccurrenceDate: "2026-09-07",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Schicht löschen" }));
    fireEvent.click(screen.getByRole("radio", { name: /Ab jetzt dauerhaft/ }));
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));

    await waitFor(() => {
      expect(endSeries).toHaveBeenCalledWith("5", "2026-09-07");
    });
  });
});

// #2028: editing the series itself — its weekdays, rhythm, window and
// validity — from the opened occurrence onwards.
describe("ShiftEditModal series rule editing", () => {
  it("states the series rule and opens the editor from the shift panel", async () => {
    renderModal({ mode: "edit", shift: seriesShift });

    // The rule is visible without saving first: which days, which window,
    // how long it runs.
    expect(
      await screen.findByText(
        "Mo, Mi \u00b7 08:00\u201312:00 \u00b7 bis Ende des Kalenderzeitraums",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Serie bearbeiten" }));

    expect(await screen.findByText("Serie bearbeiten")).toBeInTheDocument();
    // Weekdays come from the rule, not from the clicked occurrence.
    expect(screen.getByRole("button", { name: "Mo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Mi" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Di" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("applies changed weekdays and window from the opened date onwards", async () => {
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 12,
      skippedDates: [],
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderModal({ mode: "edit", shift: seriesShift, onSaved, onClose });

    await openSeriesEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Fr" }));
    fireEvent.change(screen.getByLabelText("Ende"), {
      target: { value: "14:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

    await waitFor(() => {
      expect(splitSeries).toHaveBeenCalledWith("5", {
        effectiveDate: "2026-09-07",
        occurrenceShiftId: "9",
        // ADR 0311: a split from today rewrites the opened occurrence.
        expectedOccurrenceVersion: "occurrence-v1",
        startTime: "08:00",
        endTime: "14:00",
        breakMinutes: 0,
        shiftTypeId: null,
        weekdays: [1, 3, 5],
        weekPattern: 0,
        validUntil: null,
        includeSchoolBreaks: false,
        expectedVersion: "series-v1",
      });
    });
    expect(updateShift).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("splits a moved occurrence from its original series date", async () => {
    getSeries.mockResolvedValue({ ...seriesRule, weekPattern: 1 });
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 12,
      skippedDates: [],
    });
    renderModal({
      mode: "edit",
      shift: {
        ...seriesShift,
        date: "2026-09-08",
        detached: true,
        seriesOccurrenceDate: "2026-09-14",
      },
    });

    await openSeriesEditor();
    expect(
      screen.getByText(/Die Änderungen gelten ab 14\.09\.2026/),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("14.09.2026")).toBeDisabled();
    await waitFor(() => {
      expect(
        screen.getByText("Die Woche vom 14.09.2026 ist Woche A."),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

    await waitFor(() => {
      expect(splitSeries).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({ effectiveDate: "2026-09-14" }),
      );
    });
  });

  it("keeps the stored A/B pattern while its calendar period is unavailable", async () => {
    const alternatingRule = { ...seriesRule, weekPattern: 2 as const };
    listPeriods.mockRejectedValue(
      new Error("Kalenderzeiträume nicht verfügbar"),
    );
    getSeries.mockResolvedValue(alternatingRule);
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 4,
      skippedDates: [],
    });
    renderModal({ mode: "edit", shift: seriesShift });

    await openSeriesEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Fr" }));
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

    await waitFor(() => {
      expect(splitSeries).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({ weekPattern: 2 }),
      );
    });
  });

  it("restores the occurrence draft after returning from series editing", async () => {
    updateShift.mockResolvedValue(undefined);
    renderModal({ mode: "edit", shift: seriesShift });

    fireEvent.change(screen.getByLabelText("Ende"), {
      target: { value: "13:00" },
    });
    const editSeries = await screen.findByRole("button", {
      name: "Serie bearbeiten",
    });
    // The rule loads asynchronously; clicking the still-disabled button is ignored.
    await waitFor(() => expect(editSeries).toBeEnabled());
    fireEvent.click(editSeries);
    expect(screen.getByLabelText("Ende")).toHaveValue("12:00");

    fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
    expect(screen.getByLabelText("Ende")).toHaveValue("13:00");

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Nur diese Woche/ }));

    await waitFor(() => {
      expect(updateShift).toHaveBeenCalledWith(
        "9",
        expect.objectContaining({ endTime: "13:00" }),
      );
    });
  });

  it("sends the inclusive 'G\u00fcltig bis' as the exclusive valid_until", async () => {
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 4,
      skippedDates: [],
    });
    renderModal({ mode: "edit", shift: seriesShift });

    await openSeriesEditor();
    // The stubbed DatePicker reports 2026-12-31.
    fireEvent.click(await screen.findByText("DatePicker Auswahl"));
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

    await waitFor(() => {
      expect(splitSeries).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({ validUntil: "2027-01-01" }),
      );
    });
  });

  it("keeps the occurrence scopes untouched", async () => {
    renderModal({ mode: "edit", shift: seriesShift });
    await screen.findByRole("button", { name: "Serie bearbeiten" });

    fireEvent.click(
      screen.getByRole("button", { name: "\u00c4nderungen speichern" }),
    );

    // Only the two pre-existing occurrence scopes (#1889) are offered here;
    // the series itself is edited through its own editor.
    expect(
      screen.getByRole("button", { name: /Nur diese Woche/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Ab jetzt dauerhaft/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Alle Termine der Serie/ }),
    ).not.toBeInTheDocument();
  });

  // #3820: Der Haken zeigt die gespeicherte Wahl und geht beim Speichern mit.
  it("shows the stored school-break choice and saves a changed one", async () => {
    getSeries.mockResolvedValue({ ...seriesRule, includeSchoolBreaks: true });
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 12,
      skippedDates: [],
      skippedNonWorkingDays: 0,
    });
    renderModal({ mode: "edit", shift: seriesShift });

    await openSeriesEditor();
    const box = screen.getByLabelText(
      /Auch in den Ferien und an Schließtagen planen/,
    );
    expect(box).toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

    await waitFor(() => {
      expect(splitSeries).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({
          effectiveDate: "2026-09-07",
          includeSchoolBreaks: false,
        }),
      );
    });
  });
});

// A segment whose last day has arrived used to be uneditable: the re-plan
// starts tomorrow at the earliest, so the save came back as a generic 400
// pointing at Beginn/Ende/Pause. The editor now says what to do instead (#2028).
describe("ShiftEditModal series rule editing at the end of a segment", () => {
  beforeEach(() => {
    // Fake ONLY Date: testing-library's findBy* polls on real timers.
    // 12:00 Berlin on the opened occurrence's own day.
    setTestClock(new Date("2026-09-07T10:00:00Z"));
  });

  it("warns instead of saving when nothing is left to change", async () => {
    // Exclusive valid_until 2026-09-08 = last shift day is today.
    getSeries.mockResolvedValue({ ...seriesRule, validUntil: "2026-09-08" });
    renderModal({ mode: "edit", shift: seriesShift });

    await openSeriesEditor();

    // The effective date is the clamped one, not the opened occurrence.
    expect(
      await screen.findByText(/Die Änderungen gelten ab 08\.09\.2026/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Setze „Gültig bis" auf ein späteres Datum/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));
    expect(splitSeries).not.toHaveBeenCalled();
  });

  it("saves once the end date is extended", async () => {
    getSeries.mockResolvedValue({ ...seriesRule, validUntil: "2026-09-08" });
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 12,
      skippedDates: [],
    });
    renderModal({ mode: "edit", shift: seriesShift });

    await openSeriesEditor();
    // The stubbed DatePicker picks 2026-12-31.
    fireEvent.click(await screen.findByText("DatePicker Auswahl"));
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

    await waitFor(() => {
      expect(splitSeries).toHaveBeenCalledWith("5", {
        effectiveDate: "2026-09-07",
        occurrenceShiftId: "9",
        // ADR 0311: a split from today rewrites the opened occurrence.
        expectedOccurrenceVersion: "occurrence-v1",
        startTime: "08:00",
        endTime: "12:00",
        breakMinutes: 0,
        shiftTypeId: null,
        weekdays: [1, 3],
        weekPattern: 0,
        // Picker is inclusive, the API's valid_until exclusive.
        validUntil: "2027-01-01",
        includeSchoolBreaks: false,
        expectedVersion: "series-v1",
      });
    });
  });

  it("warns instead of extending without a matching recurrence date", async () => {
    // The change starts on Tuesday. Extending a Mo/Mi series only through
    // Tuesday creates no future occurrence.
    mockDatePickerValue.value = new Date(2026, 8, 8);
    getSeries.mockResolvedValue({ ...seriesRule, validUntil: "2026-09-08" });
    renderModal({ mode: "edit", shift: seriesShift });

    await openSeriesEditor();
    fireEvent.click(await screen.findByText("DatePicker Auswahl"));

    expect(
      await screen.findByText(/Für die gewählten Wochentage/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));
    expect(splitSeries).not.toHaveBeenCalled();
  });
});

describe("ShiftEditModal error display", () => {
  it("shows a refused save in the panel and retries with the current times", async () => {
    updateShift
      .mockRejectedValueOnce(
        new ApiError("boom", 500, {
          code: "general.server",
          instance: "req-9",
        }),
      )
      .mockResolvedValueOnce(undefined);
    const onSaved = vi.fn();
    renderModal({
      mode: "edit",
      shift: { ...seriesShift, seriesId: null },
      onSaved,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );

    expect(
      await screen.findByText(catalogText("general.server", "die Schicht")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vorgangskennung kopieren" }),
    ).toHaveTextContent("req-9");
    expect(onSaved).not.toHaveBeenCalled();

    const [endInput] = document.getElementsByName("end_time");
    fireEvent.change(endInput!, { target: { value: "13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updateShift).toHaveBeenLastCalledWith(
      "9",
      expect.objectContaining({ endTime: "13:00" }),
    );
  });

  it("marks the field the server names", async () => {
    updateShift.mockRejectedValue(
      new ApiError("invalid", 400, {
        code: "general.input",
        errors: [{ field: "break_minutes", reason: "too long" }],
      }),
    );
    renderModal({ mode: "edit", shift: { ...seriesShift, seriesId: null } });

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );

    expect(
      await screen.findByText(catalogText("general.input", "die Schicht")),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.getElementsByName("break_minutes")[0]).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
  });

  it("keeps a refused delete in the confirmation", async () => {
    deleteShift.mockRejectedValue(
      new ApiError("forbidden", 403, { code: "general.permission" }),
    );
    const onClose = vi.fn();
    renderModal({
      mode: "edit",
      shift: { ...seriesShift, seriesId: null },
      onClose,
    });

    fireEvent.click(screen.getByRole("button", { name: "Schicht löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Endgültig löschen" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Schicht löschen",
    });
    expect(
      await screen.findByText(catalogText("general.permission", "die Schicht")),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      catalogText("general.permission", "die Schicht"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a failed series load in place and loads it again on retry", async () => {
    getSeries
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce(seriesRule);
    renderModal({ mode: "edit", shift: seriesShift });

    expect(
      await screen.findByText(catalogText("general.unavailable", "die Serie")),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    expect(await screen.findByText(/Mo, Mi · 08:00–12:00/)).toBeInTheDocument();
    expect(getSeries).toHaveBeenCalledTimes(2);
  });

  it("does not claim missing periods when the periods fail to load", async () => {
    listPeriods.mockRejectedValue(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );
    renderModal({});

    fireEvent.click(screen.getByText("Als Serie wiederholen"));

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Kalenderzeiträume"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Kein aktiver Kalenderzeitraum vorhanden/),
    ).not.toBeInTheDocument();
  });

  it("shows the local check in the alert when nothing is left to change", async () => {
    getSeries.mockResolvedValue({ ...seriesRule, validUntil: "2026-09-08" });
    renderModal({ mode: "edit", shift: seriesShift });

    await openSeriesEditor();
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Setze „Gültig bis" auf ein späteres Datum/,
    );
    expect(splitSeries).not.toHaveBeenCalled();
  });
});

it("shows the cached series rule on reopening and saves with the version it shows", async () => {
  setTestClock("2026-09-01T10:00:00Z");
  getSeries.mockResolvedValue({ ...seriesRule, validUntil: "2027-01-01" });
  splitSeries.mockResolvedValue({
    seriesId: "6",
    created: 1,
    skippedDates: [],
  });
  const props = {
    mode: "edit" as const,
    staffId: "7",
    staffName: "Ada Lovelace",
    date: "2026-09-07",
    shift: seriesShift,
    shiftTypes: [],
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };
  const view = render(<ShiftEditModal {...props} />);
  await openSeriesEditor();
  view.rerender(<></>);
  view.rerender(<ShiftEditModal {...props} />);
  // The cached rule is there at once (ADR 0311): the split sends its
  // version, and the server refuses a series changed since.
  expect(
    screen.getByRole("button", { name: "Serie bearbeiten" }),
  ).toBeEnabled();
  await openSeriesEditor();
  fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));
  await waitFor(() =>
    expect(splitSeries).toHaveBeenCalledWith(
      "5",
      expect.objectContaining({
        validUntil: "2027-01-01",
        expectedVersion: "series-v1",
      }),
    ),
  );
});

it("shows the stored series again without a retry when a colleague changed it", async () => {
  splitSeries.mockRejectedValueOnce(
    new ApiError("changed since it was read", 409, {
      code: "general.changed_since_read",
    }),
  );
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <ShiftEditModal
      mode="edit"
      staffId="7"
      staffName="Ada Lovelace"
      date="2026-09-07"
      shift={seriesShift}
      shiftTypes={[]}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  await openSeriesEditor();
  const reads = getSeries.mock.calls.length;
  getSeries.mockResolvedValue({
    ...seriesRule,
    validUntil: "2026-10-01",
    version: "series-v2",
  });
  fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

  expect(
    await screen.findByText(
      catalogText("general.changed_since_read", "die Serie"),
    ),
  ).toBeVisible();
  // Back on the day with the stored rule; the plan reloads, nothing closes.
  await waitFor(() =>
    expect(getSeries.mock.calls.length).toBeGreaterThan(reads),
  );
  expect(
    screen.getByRole("button", { name: "Serie bearbeiten" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Wiederholen" }),
  ).not.toBeInTheDocument();
  expect(onSaved).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  // The editor opens from the stored rule and saves against its version.
  splitSeries.mockResolvedValue({
    seriesId: "6",
    created: 1,
    skippedDates: [],
  });
  await waitFor(() =>
    expect(screen.getByText(/bis 30\.09\.2026/)).toBeInTheDocument(),
  );
  await openSeriesEditor();
  fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));
  await waitFor(() =>
    expect(splitSeries).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({
        validUntil: "2026-10-01",
        expectedVersion: "series-v2",
      }),
    ),
  );
});

describe("ShiftEditModal series editor and a colleague's change", () => {
  const colleagueRule = {
    ...seriesRule,
    validUntil: "2026-10-01",
    version: "series-v2",
  };

  function renderEditor() {
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 1,
      skippedDates: [],
    });
    render(
      <>
        <CacheHandle />
        <ShiftEditModal
          mode="edit"
          staffId="7"
          staffName="Ada Lovelace"
          date="2026-09-07"
          shift={seriesShift}
          shiftTypes={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </>,
    );
  }

  it("keeps typed input and the version it opened from when the rule is read again", async () => {
    renderEditor();
    await openSeriesEditor();
    fireEvent.change(screen.getByLabelText("Ende"), {
      target: { value: "14:00" },
    });
    getSeries.mockResolvedValue(colleagueRule);
    await act(revalidateAll);

    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));
    // The typed end stays, and the server sees the version the editor opened
    // from: it refuses instead of the save reverting the colleague's end date.
    await waitFor(() =>
      expect(splitSeries).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({
          endTime: "14:00",
          validUntil: null,
          expectedVersion: "series-v1",
        }),
      ),
    );
  });

  it("refills an untouched editor from the newer rule and saves its version", async () => {
    renderEditor();
    await openSeriesEditor();
    getSeries.mockResolvedValue(colleagueRule);
    await act(revalidateAll);

    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));
    await waitFor(() =>
      expect(splitSeries).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({
          validUntil: "2026-10-01",
          expectedVersion: "series-v2",
        }),
      ),
    );
  });
});

describe("ShiftEditModal split and the rule on screen (ADR 0311)", () => {
  function renderOccurrence() {
    render(
      <>
        <CacheHandle />
        <ShiftEditModal
          mode="edit"
          staffId="7"
          staffName="Ada Lovelace"
          date="2026-09-07"
          shift={seriesShift}
          shiftTypes={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </>,
    );
  }

  async function splitFromHere() {
    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    const following = () =>
      screen.getByRole("button", { name: /Ab jetzt dauerhaft/ });
    await waitFor(() => expect(following()).toBeEnabled());
    fireEvent.click(following());
  }

  it("splits with the version of the rule shown, not of a newer read", async () => {
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 1,
      skippedDates: [],
    });
    renderOccurrence();
    expect(await screen.findByText(/Mo, Mi/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ende"), {
      target: { value: "14:00" },
    });
    getSeries.mockResolvedValue({
      ...seriesRule,
      weekdays: [1, 3, 5],
      version: "series-v2",
    });
    await act(revalidateAll);

    await splitFromHere();
    // The colleague's Friday was never on screen: the split confirms the
    // rule shown, and the server refuses it.
    await waitFor(() =>
      expect(splitSeries).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({
          endTime: "14:00",
          expectedVersion: "series-v1",
        }),
      ),
    );
  });

  it("names a failed read of the stored rule after a refused split", async () => {
    splitSeries.mockRejectedValueOnce(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    renderOccurrence();
    expect(await screen.findByText(/Mo, Mi/)).toBeInTheDocument();
    getSeries.mockRejectedValue(
      new ApiError("down", 503, { code: "general.unavailable" }),
    );
    await splitFromHere();

    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Du siehst jetzt den neuen Stand/),
    ).not.toBeInTheDocument();
    // Nothing goes out with the refused version.
    expect(
      screen.getByRole("button", { name: "Serie bearbeiten" }),
    ).toBeDisabled();
    expect(splitSeries).toHaveBeenCalledTimes(1);
  });
});

// A split effective today also checks the opened occurrence's version
// (ADR 0311): after its refusal the next split waits for both reads and
// sends the stored series and the stored occurrence.
describe("ShiftEditModal split effective today after a refusal", () => {
  it("waits for the series and the occurrence read and sends both new versions", async () => {
    const today: StaffShift = { ...seriesShift, date: "2026-09-09" };
    splitSeries
      .mockRejectedValueOnce(
        new ApiError("changed since it was read", 409, {
          code: "general.changed_since_read",
        }),
      )
      .mockResolvedValueOnce({ seriesId: "6", created: 1, skippedDates: [] });
    let handOver: () => void = () => undefined;
    const occurrenceRead = new Promise<void>((resolve) => {
      handOver = resolve;
    });
    function Harness() {
      const [shift, setShift] = useState(today);
      return (
        <ShiftEditModal
          mode="edit"
          staffId="7"
          staffName="Ada Lovelace"
          date="2026-09-09"
          shift={shift}
          shiftTypes={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          reloadShift={async () => {
            await occurrenceRead;
            setShift({ ...today, version: "occurrence-v2" });
          }}
        />
      );
    }
    render(<Harness />);
    expect(await screen.findByText(/Mo, Mi/)).toBeInTheDocument();
    const save = () =>
      screen.getByRole("button", { name: "Änderungen speichern" });
    const splitFromHere = async () => {
      fireEvent.click(save());
      const following = await screen.findByRole("button", {
        name: /Ab jetzt dauerhaft/,
      });
      await waitFor(() => expect(following).toBeEnabled());
      fireEvent.click(following);
    };
    const reads = getSeries.mock.calls.length;
    getSeries.mockResolvedValue({ ...seriesRule, version: "series-v2" });
    await splitFromHere();

    // The series is read again; the occurrence still is on its way, and
    // nothing can go out with its refused version.
    await waitFor(() =>
      expect(getSeries.mock.calls.length).toBeGreaterThan(reads),
    );
    await waitFor(() =>
      expect(save()).toHaveAttribute("aria-disabled", "true"),
    );
    fireEvent.click(save());
    expect(
      screen.queryByRole("button", { name: /Ab jetzt dauerhaft/ }),
    ).not.toBeInTheDocument();

    await act(async () => {
      handOver();
      await occurrenceRead;
    });
    await waitFor(() => expect(save()).not.toHaveAttribute("aria-disabled"));
    await splitFromHere();
    await waitFor(() => expect(splitSeries).toHaveBeenCalledTimes(2));
    expect(splitSeries).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({
        expectedVersion: "series-v2",
        expectedOccurrenceVersion: "occurrence-v2",
      }),
    );
  });
});

// The dialog's reload answers with the stored shift (ADR 0311). An answer
// equal to what the dialog holds changes no prop: only the answer lets the
// day's draft settle, and only the settled draft's token goes out.
describe("ShiftEditModal reload answered with the stored shift", () => {
  const today: StaffShift = { ...seriesShift, date: "2026-09-09" };
  const refusal = () =>
    new ApiError("changed since it was read", 409, {
      code: "general.changed_since_read",
    });

  function renderToday(reloadShift: () => Promise<unknown>) {
    render(
      <ShiftEditModal
        mode="edit"
        staffId="7"
        staffName="Ada Lovelace"
        date="2026-09-09"
        shift={today}
        shiftTypes={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        reloadShift={
          reloadShift as () => Promise<{
            shift: StaffShift;
            covers: StaffShift[];
          }>
        }
      />,
    );
  }

  it("unlocks the split again when only the series changed", async () => {
    splitSeries
      .mockRejectedValueOnce(refusal())
      .mockResolvedValueOnce({ seriesId: "6", created: 1, skippedDates: [] });
    // The occurrence is unchanged: same version, same props.
    renderToday(() => Promise.resolve({ shift: today, covers: [] }));
    expect(await screen.findByText(/Mo, Mi/)).toBeInTheDocument();
    const save = () =>
      screen.getByRole("button", { name: "Änderungen speichern" });
    const splitFromHere = async () => {
      fireEvent.click(save());
      const following = await screen.findByRole("button", {
        name: /Ab jetzt dauerhaft/,
      });
      await waitFor(() => expect(following).toBeEnabled());
      fireEvent.click(following);
    };
    getSeries.mockResolvedValue({ ...seriesRule, version: "series-v2" });
    await splitFromHere();
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Serie"),
      ),
    ).toBeVisible();

    await waitFor(() => expect(save()).not.toHaveAttribute("aria-disabled"));
    await splitFromHere();
    await waitFor(() => expect(splitSeries).toHaveBeenCalledTimes(2));
    expect(splitSeries).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({
        expectedVersion: "series-v2",
        expectedOccurrenceVersion: "occurrence-v1",
      }),
    );
  });

  it("keeps 'Serie speichern' locked until the occurrence is read again", async () => {
    splitSeries
      .mockRejectedValueOnce(refusal())
      .mockResolvedValueOnce({ seriesId: "6", created: 1, skippedDates: [] });
    let handOver: () => void = () => undefined;
    const occurrenceRead = new Promise<void>((resolve) => {
      handOver = resolve;
    });
    function Harness() {
      const [shift, setShift] = useState(today);
      return (
        <ShiftEditModal
          mode="edit"
          staffId="7"
          staffName="Ada Lovelace"
          date="2026-09-09"
          shift={shift}
          shiftTypes={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          reloadShift={async () => {
            await occurrenceRead;
            const stored = { ...today, version: "occurrence-v2" };
            setShift(stored);
            return { shift: stored, covers: [] };
          }}
        />
      );
    }
    render(<Harness />);
    await openSeriesEditor();
    const reads = getSeries.mock.calls.length;
    getSeries.mockResolvedValue({ ...seriesRule, version: "series-v2" });
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));
    await waitFor(() =>
      expect(getSeries.mock.calls.length).toBeGreaterThan(reads),
    );

    // The series is read again, the occurrence not yet: the editor opens,
    // but nothing goes out with the refused occurrence version.
    await openSeriesEditor();
    const saveSeries = () =>
      screen.getByRole("button", { name: /^Serie speichern/ });
    expect(saveSeries()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(saveSeries());
    expect(splitSeries).toHaveBeenCalledTimes(1);

    await act(async () => {
      handOver();
      await occurrenceRead;
    });
    // The stored occurrence arrived: the dialog starts anew on it.
    await openSeriesEditor();
    await waitFor(() =>
      expect(saveSeries()).not.toHaveAttribute("aria-disabled"),
    );
    fireEvent.click(saveSeries());
    await waitFor(() => expect(splitSeries).toHaveBeenCalledTimes(2));
    expect(splitSeries).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({
        expectedVersion: "series-v2",
        expectedOccurrenceVersion: "occurrence-v2",
      }),
    );
  });

  it("confirms the occurrence the person edited, not a newer one in the props", async () => {
    splitSeries.mockResolvedValue({
      seriesId: "6",
      created: 1,
      skippedDates: [],
    });
    const props = {
      mode: "edit" as const,
      staffId: "7",
      staffName: "Ada Lovelace",
      date: "2026-09-09",
      shiftTypes: [],
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };
    const view = render(<ShiftEditModal {...props} shift={today} />);
    expect(await screen.findByText(/Mo, Mi/)).toBeInTheDocument();
    // Typed on the day: the draft keeps the occurrence it opened from.
    fireEvent.change(screen.getByLabelText("Ende"), {
      target: { value: "14:00" },
    });
    // A colleague's change of the occurrence arrives with the plan reload.
    view.rerender(
      <ShiftEditModal
        {...props}
        shift={{ ...today, version: "occurrence-v2" }}
      />,
    );
    await openSeriesEditor();
    fireEvent.click(screen.getByRole("button", { name: "Serie speichern" }));

    // The server refuses instead of rewriting a day the person never saw.
    await waitFor(() =>
      expect(splitSeries).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({
          expectedOccurrenceVersion: "occurrence-v1",
        }),
      ),
    );
  });
});
