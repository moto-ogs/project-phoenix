import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import type { CareRunSchool } from "~/lib/traeger-care-review-api";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";

vi.unmock("swr");

// The start of a monthly run (#5916): every free school is chosen, a
// school in an open run of the month cannot be chosen, and the start sends
// month, schools and invoice date.

const { review } = vi.hoisted(() => ({
  review: { fetchCareRunSchools: vi.fn() },
}));
vi.mock("~/lib/traeger-care-review-api", async (original) => ({
  ...(await original<typeof import("~/lib/traeger-care-review-api")>()),
  ...review,
}));

import { CareRunStartModal } from "./care-run-start-modal";

const MONTHS = [{ value: "2026-10-01", label: "Oktober 2026" }];

function renderModal(onStart = vi.fn().mockResolvedValue(undefined)) {
  render(
    <TraegerResourceTestProvider>
      <CareRunStartModal
        isOpen
        months={MONTHS}
        initialMonth="2026-10-01"
        onClose={vi.fn()}
        onStart={onStart}
        onStarted={vi.fn()}
      />
    </TraegerResourceTestProvider>,
  );
  return onStart;
}

describe("CareRunStartModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    review.fetchCareRunSchools.mockResolvedValue([
      { id: "1", name: "Grundschule Birkenfeld", openRunId: null },
      { id: "2", name: "Grundschule Ispringen", openRunId: null },
      { id: "3", name: "Ludwig-Uhland-Schule", openRunId: "9" },
    ]);
  });

  it("chooses every free school and starts with them", async () => {
    const onStart = renderModal();
    const taken = await screen.findByRole("checkbox", {
      name: /Ludwig-Uhland-Schule/,
    });
    expect(taken).toBeDisabled();
    expect(taken).not.toBeChecked();
    expect(
      screen.getByText("Schon in einem offenen Lauf für Oktober 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Grundschule Birkenfeld/ }),
    ).toBeChecked();
    expect(review.fetchCareRunSchools).toHaveBeenCalledWith("2026-10-01");

    fireEvent.click(screen.getByRole("button", { name: "Vorschau öffnen" }));
    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith({
        billingMonth: "2026-10-01",
        schoolIds: ["1", "2"],
        invoiceDate: null,
      }),
    );
  });

  it("needs at least one school", async () => {
    const onStart = renderModal();
    fireEvent.click(
      await screen.findByRole("button", { name: "Keine wählen" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Vorschau öffnen" }));
    expect(
      await screen.findByText("Bitte wähle mindestens eine Schule."),
    ).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });
});

it("preserves deliberate choices across refreshed school data and removes only unavailable schools", async () => {
  const schools: CareRunSchool[] = [
    { id: "1", name: "Birkenfeld", openRunId: null },
    { id: "2", name: "Ispringen", openRunId: null },
  ];
  review.fetchCareRunSchools.mockReset().mockResolvedValue(schools);
  const onStart = vi.fn().mockResolvedValue(undefined);
  let refresh!: () => Promise<unknown>;
  function Probe() {
    const invalidate = useInvalidateFamily();
    refresh = () =>
      invalidate(traegerBillingRunKeys.careRunSchools("2026-10-01"));
    return null;
  }
  render(
    <TraegerResourceTestProvider>
      <CareRunStartModal
        isOpen
        months={MONTHS}
        initialMonth="2026-10-01"
        onClose={vi.fn()}
        onStart={onStart}
        onStarted={vi.fn()}
      />
      <Probe />
    </TraegerResourceTestProvider>,
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "Ispringen" }));
  expect(screen.getByRole("checkbox", { name: "Ispringen" })).not.toBeChecked();
  review.fetchCareRunSchools.mockResolvedValue([
    { ...schools[0], name: "Birkenfeld neu" },
    schools[1],
    { id: "4", name: "Neue Schule", openRunId: null },
  ]);
  await act(async () => {
    await refresh();
  });
  expect(
    await screen.findByRole("checkbox", { name: "Birkenfeld neu" }),
  ).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Ispringen" })).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Neue Schule" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Neue Schule" }));
  review.fetchCareRunSchools.mockResolvedValue([
    { ...schools[0], openRunId: "9" },
    schools[1],
    { id: "4", name: "Neue Schule", openRunId: null },
  ]);
  await act(async () => {
    await refresh();
  });
  expect(
    await screen.findByRole("checkbox", { name: /Birkenfeld/ }),
  ).toBeDisabled();
  expect(
    screen.getByRole("checkbox", { name: /Birkenfeld/ }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Vorschau öffnen" }));
  await waitFor(() =>
    expect(onStart).toHaveBeenCalledWith({
      billingMonth: "2026-10-01",
      schoolIds: ["4"],
      invoiceDate: null,
    }),
  );
});

it("keeps each month's choice within an opening and resets it on reopening", async () => {
  review.fetchCareRunSchools.mockReset().mockResolvedValue([
    { id: "1", name: "Birkenfeld", openRunId: null },
    { id: "2", name: "Ispringen", openRunId: null },
  ]);
  const months = [...MONTHS, { value: "2026-11-01", label: "November 2026" }];
  const props = {
    months,
    initialMonth: "2026-10-01",
    onClose: vi.fn(),
    onStart: vi.fn(),
    onStarted: vi.fn(),
  };
  const view = render(<CareRunStartModal {...props} isOpen />, {
    wrapper: TraegerResourceTestProvider,
  });
  fireEvent.click(await screen.findByRole("checkbox", { name: "Ispringen" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Monat" }));
  fireEvent.click(screen.getByRole("option", { name: "November 2026" }));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Ispringen" })).toBeChecked(),
  );
  fireEvent.click(screen.getByRole("combobox", { name: "Monat" }));
  fireEvent.click(screen.getByRole("option", { name: "Oktober 2026" }));
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "Ispringen" }),
    ).not.toBeChecked(),
  );
  view.rerender(<CareRunStartModal {...props} isOpen={false} />);
  view.rerender(<CareRunStartModal {...props} isOpen />);
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Ispringen" })).toBeChecked(),
  );
});
