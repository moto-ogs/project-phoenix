import {
  fireEvent,
  render as renderPlain,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type {
  HolidayContribution,
  HolidayPayerChoice,
  HolidayPayerPreview,
} from "~/lib/traeger-contributions-api";
import {
  HOLIDAY_CONTRIBUTION,
  HOLIDAY_REGISTRATION,
} from "~/test/fixtures/holiday-registrations";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";

const mocks = vi.hoisted(() => ({
  fetchPreview: vi.fn(),
  changePayer: vi.fn(),
}));

vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({
    data: { user: { id: "A", scope: "org", orgId: "7", permissions: [] } },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace("/traeger", ""),
}));
vi.mock("~/lib/traeger-contributions-api", () => ({
  fetchHolidayPayerChange: (
    periodId: string,
    registrationId: string,
    choice: HolidayPayerChoice,
  ) => mocks.fetchPreview(periodId, registrationId, choice),
  changeHolidayPayer: (
    periodId: string,
    registrationId: string,
    choice: HolidayPayerChoice,
    reason: string,
    fingerprint: string,
  ) => mocks.changePayer(periodId, registrationId, choice, reason, fingerprint),
}));

import { HolidayPayerEditor } from "./holiday-payer-editor";

const REGISTRATION = { ...HOLIDAY_REGISTRATION, status: "confirmed" as const };
const FROZEN: HolidayContribution = {
  ...HOLIDAY_CONTRIBUTION,
  frozen: true,
  confirmedAt: "2026-09-08T10:00:00Z",
  fingerprint: "",
};
const OFFICE = { id: "4", name: "Fachdienst Jugend" };
const FAMILY = { kind: "family", costBearerId: null, costBearerName: "" };

/** The preview the backend answers for a choice, from the family paying. */
function previewOf(
  choice: HolidayPayerChoice,
  invoiced = false,
): HolidayPayerPreview {
  const takeover = choice.kind === "cost_bearer";
  const free = choice.kind !== "family";
  return {
    current: { ...FAMILY, kind: "family" },
    chosen: {
      kind: choice.kind,
      costBearerId: choice.costBearerId,
      costBearerName: takeover ? OFFICE.name : "",
    },
    changed: free,
    children: [
      {
        childId: "9",
        position: 1,
        familyBeforeCents: 6750,
        familyAfterCents: free ? 0 : 6750,
        costBearerBeforeCents: 0,
        costBearerAfterCents: takeover ? 6750 : 0,
      },
      {
        childId: "10",
        position: 2,
        familyBeforeCents: 2250,
        familyAfterCents: free ? 0 : 2250,
        costBearerBeforeCents: 0,
        costBearerAfterCents: takeover ? 2250 : 0,
      },
    ],
    exemptionAvailable: true,
    invoiced,
    fingerprint: `vorschau-${choice.kind}`,
  };
}

function renderEditor(
  props: Partial<React.ComponentProps<typeof HolidayPayerEditor>> = {},
) {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  renderPlain(
    <ToastProvider>
      <HolidayPayerEditor
        periodId="3"
        registration={REGISTRATION}
        contribution={FROZEN}
        costBearers={[OFFICE]}
        onSaved={onSaved}
        onCancel={onCancel}
        {...props}
      />
    </ToastProvider>,
    { wrapper: TraegerResourceTestProvider },
  );
  return { onSaved, onCancel };
}

const save = () => screen.getByRole("button", { name: "Änderung speichern" });

describe("HolidayPayerEditor", () => {
  beforeEach(() => {
    mocks.fetchPreview.mockReset();
    mocks.changePayer.mockReset();
    mocks.fetchPreview.mockImplementation(
      (_period: string, _registration: string, choice: HolidayPayerChoice) =>
        Promise.resolve(previewOf(choice)),
    );
  });

  it("names the payer now and saves nothing while it is unchanged", async () => {
    renderEditor();

    expect(
      screen.getByText("Bisher bezahlt: Die Familie."),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("radio", { name: /^Die Familie bezahlt/ }),
    ).toBeChecked();
    expect(
      screen.getByText(/Wähle oben einen anderen Zahler/),
    ).toBeInTheDocument();
    expect(save()).toHaveAttribute("aria-disabled", "true");
  });

  it("shows per child what the family and the cost bearer pay before it saves", async () => {
    const { onSaved } = renderEditor();
    mocks.changePayer.mockResolvedValue(FROZEN);

    fireEvent.click(
      await screen.findByRole("radio", {
        name: /Kosten übernimmt ein Kostenträger/,
      }),
    );
    const effects = within(
      (await screen.findByText("Lia Muster")).closest("div")!.parentElement!,
    );
    expect(effects.getByText("Ben Muster")).toBeInTheDocument();
    expect(effects.getByText("Alle Kinder")).toBeInTheDocument();
    // Lia: the family 67,50 € → 0,00 €, the cost bearer 0,00 € → 67,50 €.
    expect(effects.getAllByText("67,50 €")).toHaveLength(2);
    expect(effects.getAllByText("90,00 €")).toHaveLength(2);
    expect(effects.getAllByText("Der Kostenträger bezahlt")).toHaveLength(3);

    // The reason is required and stands at its field.
    fireEvent.click(save());
    expect(
      await screen.findByText("Bitte gib eine Begründung ein."),
    ).toBeInTheDocument();
    expect(mocks.changePayer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Begründung/), {
      target: { value: " Bescheid nachgereicht " },
    });
    fireEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.changePayer).toHaveBeenCalledWith(
      "3",
      REGISTRATION.id,
      { kind: "cost_bearer", costBearerId: "4" },
      "Bescheid nachgereicht",
      "vorschau-cost_bearer",
    );
    expect(
      await screen.findByText("Der Zahler ist geändert."),
    ).toBeInTheDocument();
  });

  it("says that an exemption is no claim on a cost bearer", async () => {
    renderEditor();

    fireEvent.click(
      await screen.findByRole("radio", { name: /Von der Zahlung befreien/ }),
    );
    expect(
      await screen.findByText(/Bei einer Befreiung bezahlt niemand/),
    ).toBeInTheDocument();
    // No cost bearer pays before or after: its row would only show zeros.
    expect(
      screen.queryByText("Der Kostenträger bezahlt"),
    ).not.toBeInTheDocument();
  });

  it("names the way to the Storno when the invoice is already issued", async () => {
    mocks.fetchPreview.mockImplementation(
      (_period: string, _registration: string, choice: HolidayPayerChoice) =>
        Promise.resolve(previewOf(choice, true)),
    );
    renderEditor({ billingHref: "/abrechnung/laeufe/1" });

    fireEvent.click(
      await screen.findByRole("radio", {
        name: /Kosten übernimmt ein Kostenträger/,
      }),
    );
    expect(
      await screen.findByText("Die Rechnung ist schon ausgestellt"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zur Abrechnung" }),
    ).toHaveAttribute("href", "/abrechnung/laeufe/1");
  });

  it("takes the change back to the family from a cost bearer", async () => {
    mocks.fetchPreview.mockImplementation(() =>
      Promise.resolve({
        ...previewOf({ kind: "family", costBearerId: null }),
        current: {
          kind: "cost_bearer",
          costBearerId: "4",
          costBearerName: OFFICE.name,
        },
        changed: true,
      }),
    );
    renderEditor({
      contribution: {
        ...FROZEN,
        costBearerId: "4",
        costBearerName: OFFICE.name,
      },
    });

    expect(
      screen.getByText("Bisher bezahlt: Kostenträger: Fachdienst Jugend."),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("radio", {
        name: /Kosten übernimmt ein Kostenträger/,
      }),
    ).toBeChecked();
    expect(save()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(
      screen.getByRole("radio", { name: /^Die Familie bezahlt/ }),
    );
    await waitFor(() => expect(save()).not.toHaveAttribute("aria-disabled"));
  });

  it("keeps the form open and reads the amounts again after a refusal of a changed state", async () => {
    const { onSaved } = renderEditor();
    mocks.changePayer.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );

    fireEvent.click(
      await screen.findByRole("radio", {
        name: /Kosten übernimmt ein Kostenträger/,
      }),
    );
    await screen.findByText("Lia Muster");
    fireEvent.change(screen.getByLabelText(/Begründung/), {
      target: { value: "Bescheid" },
    });
    const reads = mocks.fetchPreview.mock.calls.length;
    fireEvent.click(save());

    await waitFor(() =>
      expect(mocks.fetchPreview.mock.calls.length).toBeGreaterThan(reads),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Begründung/)).toHaveValue("Bescheid");
  });
});
