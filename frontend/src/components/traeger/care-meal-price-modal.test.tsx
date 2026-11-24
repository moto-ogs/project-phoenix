import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import {
  type CareMealTariffs,
  saveCareMealTariff,
} from "~/lib/traeger-care-meal-api";
import { CareMealPriceModal } from "./care-meal-price-modal";

vi.mock("~/lib/traeger-care-meal-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveCareMealTariff: vi.fn(),
}));

const SCHOOL = { id: "s1", name: "Grundschule am Park" };
// A prop of the modal, not the clock: the modal reads no date itself.
const CURRENT_MONTH = "2026-09-01";

function tariffs(version: string, billedUntil?: string): CareMealTariffs {
  return {
    schools: [SCHOOL],
    tariffs: [
      {
        id: "t1",
        schoolId: SCHOOL.id,
        validFrom: "2026-01-01",
        validUntil: null,
        mode: "per_meal",
        amountCents: 480,
      },
    ],
    billedUntil: billedUntil ? { [SCHOOL.id]: billedUntil } : {},
    versions: { [SCHOOL.id]: version },
  };
}

/** The page: its read is what the modal shows; `reload` reads it again. */
function renderModal(
  initial: CareMealTariffs,
  reload: () => Promise<CareMealTariffs>,
) {
  let setShown!: (next: CareMealTariffs) => void;
  function Page() {
    const [shown, set] = useState(initial);
    setShown = set;
    return (
      <CareMealPriceModal
        data={shown}
        school={SCHOOL}
        currentMonth={CURRENT_MONTH}
        reload={async () => {
          const read = await reload();
          set(read);
          return read;
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
  }
  render(<Page />, { wrapper: ToastProvider });
  return { setShown: (next: CareMealTariffs) => setShown(next) };
}

async function chooseMonth(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Gültig ab" }));
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("CareMealPriceModal", () => {
  // ADR 0311, rule 4: the lock after a refusal holds over another month,
  // which would otherwise start a new draft on the refused version.
  it("sends nothing in another month until the stored prices are read", async () => {
    let finishReload!: (read: CareMealTariffs) => void;
    const reload = vi.fn(
      () =>
        new Promise<CareMealTariffs>((resolve) => {
          finishReload = resolve;
        }),
    );
    const save = vi.mocked(saveCareMealTariff);
    save.mockReset();
    save.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    save.mockResolvedValue(tariffs("v3"));
    renderModal(tariffs("v1"), reload);

    fireEvent.click(screen.getByRole("button", { name: "Preis speichern" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ validFrom: CURRENT_MONTH }),
      "v1",
    );

    await chooseMonth("Oktober 2026");
    fireEvent.click(screen.getByRole("button", { name: "Preis speichern" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Gültig ab" }),
      ).toHaveTextContent("Oktober 2026"),
    );
    expect(save).toHaveBeenCalledTimes(1);

    finishReload(tariffs("v2"));
    await chooseMonth("Oktober 2026");
    fireEvent.click(screen.getByRole("button", { name: "Preis speichern" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ validFrom: "2026-10-01" }),
      "v2",
    );
  });

  it("keeps the chosen month when a newer read bills another month", async () => {
    const { setShown } = renderModal(tariffs("v1"), async () => tariffs("v1"));
    await chooseMonth("November 2026");

    act(() => setShown(tariffs("v1", "2026-09-01")));
    expect(
      screen.getByRole("combobox", { name: "Gültig ab" }),
    ).toHaveTextContent("November 2026");
  });
});
