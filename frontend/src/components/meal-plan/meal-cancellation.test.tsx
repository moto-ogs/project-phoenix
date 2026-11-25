import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  cancelMeal: vi.fn(),
  getMealCancellations: vi.fn(),
  restoreMeal: vi.fn(),
}));

vi.unmock("swr");

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "account-1", tenantId: "1", scope: "tenant" } },
    status: "authenticated",
  }),
}));

vi.mock("~/lib/meal-plan-api", () => ({
  cancelMeal: mocks.cancelMeal,
  getMealCancellations: mocks.getMealCancellations,
  restoreMeal: mocks.restoreMeal,
}));

import { ToastProvider as Toasts } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import { MealCancellationModal } from "./meal-cancellation";

function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <Toasts>{children}</Toasts>
    </SWRConfig>
  );
}

describe("MealCancellationModal (#7656)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelMeal.mockResolvedValue(undefined);
  });

  it("trägt den Ausfall erst mit einem Grund ein und schließt danach", async () => {
    const onClose = vi.fn();
    render(
      <MealCancellationModal
        date="2026-09-09"
        dayLabel="Mittwoch, 09.09."
        initialReason=""
        onClose={onClose}
      />,
      { wrapper: Providers },
    );

    const save = screen.getByRole("button", { name: "Speichern" });
    fireEvent.click(save);
    expect(mocks.cancelMeal).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Grund/ }), {
      target: { value: "  Der Caterer liefert nicht  " },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(mocks.cancelMeal).toHaveBeenCalledWith(
        "2026-09-09",
        "Der Caterer liefert nicht",
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(
      await screen.findByText("Das Essen am Mittwoch, 09.09. fällt aus."),
    ).toBeInTheDocument();
  });
});
