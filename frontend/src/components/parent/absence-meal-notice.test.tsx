import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbsenceMealNotice, loadAbsenceMealDays } from "./absence-meal-notice";
import { SickNoteModal } from "./child-care";
import * as parentApi from "~/lib/parent-api";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";
import { testClockDay, TEST_CLOCK_TODAY } from "~/test/clock";
import { waitFor } from "~/test/wait-for-state";

vi.unmock("swr");

vi.mock("~/components/ui/date-picker", async () =>
  (await import("~/test/mocks/date-picker")).datePickerModuleMock(),
);

vi.mock("~/lib/parent-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/parent-api")>()),
  getMealParticipation: vi.fn(),
  setMealParticipationDay: vi.fn(),
}));

const getMealParticipation = vi.mocked(parentApi.getMealParticipation);
const setMealParticipationDay = vi.mocked(parentApi.setMealParticipationDay);

function renderParent(ui: ReactElement) {
  return render(ui, { wrapper: ParentResourceTestProvider });
}

function mealDay(
  date: string,
  participating: boolean,
  canCancel = true,
): parentMeContract.MealParticipationDayResponse {
  return {
    date,
    participating,
    regular_participating: true,
    source: participating ? "regular" : "sick",
    changeable: canCancel,
    can_register: canCancel,
    can_cancel: canCancel,
    register_until: `${date}T07:00:00Z`,
    cancel_until: `${date}T07:00:00Z`,
  };
}

function mealPlan(
  days: parentMeContract.MealParticipationDayResponse[],
): parentApi.MealParticipation {
  return {
    weekdays: [1, 2, 3, 4, 5],
    days,
    effective_from: "2026-08-01",
    cutoff_time: "09:00",
    model: "ongoing_single",
    schedule_changeable: true,
    sick_cancels_after_deadline: false,
    version: "v1",
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadAbsenceMealDays", () => {
  it("keeps only the reported days the child still eats on", async () => {
    const first = testClockDay(1);
    const second = testClockDay(2);
    getMealParticipation.mockResolvedValue(
      mealPlan([
        mealDay(TEST_CLOCK_TODAY, true),
        mealDay(first, false),
        mealDay(second, true, false),
      ]),
    );

    await expect(loadAbsenceMealDays("7", [second, first])).resolves.toEqual([
      { date: second, canCancel: false },
    ]);
    expect(getMealParticipation).toHaveBeenCalledWith("7", first, second);
  });
});

describe("AbsenceMealNotice", () => {
  it("cancels the days still open and names the days past the deadline", async () => {
    const open = testClockDay(1);
    const late = TEST_CLOCK_TODAY;
    setMealParticipationDay.mockResolvedValue();
    renderParent(
      <AbsenceMealNotice
        studentId="7"
        days={[
          { date: late, canCancel: false },
          { date: open, canCancel: true },
        ]}
      />,
    );

    expect(screen.getByText("Essen noch angemeldet")).toBeInTheDocument();
    expect(screen.getByText(/Abmeldefrist vorbei/)).toBeInTheDocument();
    expect(
      screen.getByText(/Nach der Frist kann nur die OGS das Essen abmelden/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Auch abmelden" }));

    await waitFor(() =>
      expect(setMealParticipationDay).toHaveBeenCalledTimes(1),
    );
    expect(setMealParticipationDay).toHaveBeenCalledWith("7", open, false);
    // The day past the deadline stays and the button is gone with the open day.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Auch abmelden" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Abmeldefrist vorbei/)).toBeInTheDocument();
  });

  it("confirms when every day is cancelled", async () => {
    setMealParticipationDay.mockResolvedValue();
    renderParent(
      <AbsenceMealNotice
        studentId="7"
        days={[{ date: testClockDay(1), canCancel: true }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Auch abmelden" }));

    expect(
      await screen.findByText("Das Essen ist für diese Tage abgemeldet."),
    ).toBeInTheDocument();
  });
});

describe("SickNoteModal — Essen noch angemeldet", () => {
  it("names the registered meal after a request and cancels it", async () => {
    getMealParticipation.mockResolvedValue(
      mealPlan([mealDay(TEST_CLOCK_TODAY, true)]),
    );
    setMealParticipationDay.mockResolvedValue();
    const onClose = vi.fn();
    renderParent(
      <SickNoteModal
        studentId="7"
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue("pending")}
        excusedRequiresApproval
        reasonRequired={false}
        mealRegistrationEnabled
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Krankmeldung an die OGS senden" }),
    );

    expect(
      await screen.findByText("Essen noch angemeldet"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Auch abmelden" }));
    await waitFor(() =>
      expect(setMealParticipationDay).toHaveBeenCalledWith(
        "7",
        TEST_CLOCK_TODAY,
        false,
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open after an applied report while a meal is registered", async () => {
    getMealParticipation.mockResolvedValue(
      mealPlan([mealDay(TEST_CLOCK_TODAY, true, false)]),
    );
    const onClose = vi.fn();
    renderParent(
      <SickNoteModal
        studentId="7"
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue("applied")}
        reasonRequired={false}
        mealRegistrationEnabled
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Krankmeldung an die OGS senden" }),
    );

    expect(await screen.findByText("Abwesenheit gemeldet")).toBeInTheDocument();
    expect(screen.getByText(/Abmeldefrist vorbei/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Auch abmelden" }),
    ).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without a hint when the meal is already cancelled", async () => {
    getMealParticipation.mockResolvedValue(
      mealPlan([mealDay(TEST_CLOCK_TODAY, false)]),
    );
    const onClose = vi.fn();
    renderParent(
      <SickNoteModal
        studentId="7"
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue("applied")}
        reasonRequired={false}
        mealRegistrationEnabled
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Krankmeldung an die OGS senden" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("reads no meal days where the parent does not register meals", async () => {
    const onClose = vi.fn();
    renderParent(
      <SickNoteModal
        studentId="7"
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue("applied")}
        reasonRequired={false}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Krankmeldung an die OGS senden" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getMealParticipation).not.toHaveBeenCalled();
  });
});
