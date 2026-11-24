import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { HolidayRegistrationDetail } from "~/lib/traeger-holiday-registrations-api";
import { catalogText } from "~/test/error-catalog-text";

const { mockWithdraw } = vi.hoisted(() => ({ mockWithdraw: vi.fn() }));
vi.mock("~/lib/traeger-holiday-registrations-api", () => ({
  withdrawHolidayConsent: (period: string, registration: string, key: string) =>
    mockWithdraw(period, registration, key),
}));

import { HolidayConsentWithdrawButton } from "./holiday-consent-withdraw-button";

function renderButton(onChanged = vi.fn()) {
  render(
    <ToastProvider>
      <HolidayConsentWithdrawButton
        periodId="5"
        registrationId="11"
        consentKey="fotos"
        title="Fotos in der Ferienbetreuung"
        onChanged={onChanged}
      />
    </ToastProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  mockWithdraw.mockReset();
});

describe("HolidayConsentWithdrawButton (#8038)", () => {
  it("records the parents' withdrawal only after asking and hands on the changed registration", async () => {
    const changed = { id: "11" } as HolidayRegistrationDetail;
    mockWithdraw.mockResolvedValueOnce(changed);
    const onChanged = renderButton();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Widerruf von „Fotos in der Ferienbetreuung“ eintragen",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Widerruf eintragen?",
    });
    expect(within(dialog).getByText(/sieht ihn sofort/)).toBeInTheDocument();
    expect(mockWithdraw).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Widerruf eintragen" }),
    );

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(changed));
    expect(mockWithdraw).toHaveBeenCalledWith("5", "11", "fotos");
  });

  it("keeps a refusal in the open dialog", async () => {
    mockWithdraw.mockRejectedValueOnce(
      new ApiError("conflict", 409, {
        code: "enrollment.holiday_registration_state_conflict",
      }),
    );
    const onChanged = renderButton();
    fireEvent.click(screen.getByRole("button", { name: /Widerruf von/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "Widerruf eintragen?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Widerruf eintragen" }),
    );
    expect(
      await within(dialog).findByText(
        catalogText(
          "enrollment.holiday_registration_state_conflict",
          "Der Widerruf",
        ),
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
