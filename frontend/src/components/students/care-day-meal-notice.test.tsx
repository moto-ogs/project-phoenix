import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CareDayMealNotice } from "./care-day-meal-notice";
import * as mealPlanApi from "~/lib/meal-plan-api";
import { testClockDay } from "~/test/clock";
import { waitFor } from "~/test/wait-for-state";

vi.mock("~/lib/meal-plan-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/meal-plan-api")>()),
  setChildMealDay: vi.fn(),
}));

const setChildMealDay = vi.mocked(mealPlanApi.setChildMealDay);

afterEach(() => {
  vi.clearAllMocks();
});

describe("CareDayMealNotice", () => {
  it("names the registered meal of the cancelled day and cancels it", async () => {
    const day = testClockDay(1);
    setChildMealDay.mockResolvedValue();
    render(<CareDayMealNotice studentId="7" date={day} onDismiss={vi.fn()} />);

    expect(screen.getByText("Essen noch angemeldet")).toBeInTheDocument();
    expect(
      screen.getByText(/Das Essen wird nicht von selbst abgemeldet/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Auch abmelden" }));

    await waitFor(() =>
      expect(setChildMealDay).toHaveBeenCalledWith("7", day, false),
    );
    expect(await screen.findByText(/ist abgemeldet\.$/)).toBeInTheDocument();
  });

  it("closes on request", () => {
    const onDismiss = vi.fn();
    render(
      <CareDayMealNotice
        studentId="7"
        date={testClockDay(1)}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hinweis schließen" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
