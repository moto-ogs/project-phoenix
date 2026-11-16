// #6593: Solange eine manuelle Anmeldung gesendet wird (auch während der
// Rückfrage „Ist das Kind schon angemeldet?“), lässt sich das Panel nicht
// schließen; eine späte Antwort meldet keinen Erfolg in einem neu geöffneten
// Panel.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deferred,
  expectSlideOverSaveLocked,
  expectSlideOverUnlocked,
} from "~/test/helpers/form-modal-pending";

vi.unmock("swr");

vi.mock("vaul", () => import("~/test/mocks/vaul"));

const mocks = vi.hoisted(() => ({
  createManualApprovedEnrollment: vi.fn(),
  fetchManualEnrollmentBootstrap: vi.fn(),
  fetchCareOfferingBookingStats: vi.fn(),
  // Called once the stub form has handled the submitter's outcome.
  submitSettled: vi.fn(),
}));

vi.mock("~/lib/enrollment-admin-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createManualApprovedEnrollment: mocks.createManualApprovedEnrollment,
  fetchManualEnrollmentBootstrap: mocks.fetchManualEnrollmentBootstrap,
}));
vi.mock("~/lib/care-offering-booking-stats", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCareOfferingBookingStats: mocks.fetchCareOfferingBookingStats,
}));

// The enrollment form is not under test: its send button hands one child to
// the panel's submitter and reports like the real form (a null result stays
// quiet, a thrown error shows in the form).
vi.mock("~/components/enrollment/enrollment-form", () => ({
  EnrollmentForm: function EnrollmentFormStub({
    submitter,
    onSubmitted,
    submitLabel,
    prefetchedData,
  }: {
    submitter: (payload: unknown) => Promise<{ status_url: string } | null>;
    onSubmitted: (url: string) => void;
    submitLabel: string;
    prefetchedData: { offerings: { name: string }[] };
  }) {
    const [failed, setFailed] = useState(false);
    // Like the real form, the template is read once when it mounts.
    const [offerings] = useState(prefetchedData.offerings);
    return (
      <div>
        {offerings.map((offering) => (
          <p key={offering.name}>Angebot {offering.name}</p>
        ))}
        {failed ? <p>Senden fehlgeschlagen</p> : null}
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            submitter({
              children: [{ first_name: "Mia", last_name: "Muster" }],
            })
              .then((result) => {
                if (result) onSubmitted(result.status_url);
              })
              .catch(() => setFailed(true))
              .finally(() => mocks.submitSettled());
          }}
        >
          {submitLabel}
        </button>
      </div>
    );
  },
}));

import { ToastProvider } from "~/contexts/ToastContext";
import { SWRConfig } from "~/lib/swr/testing";
import { ApiError } from "~/lib/api-error";
import type { Phase } from "~/lib/enrollment-phase-api";
import { schema } from "~/test/enrollment-editors";
import { catalogText } from "~/test/error-catalog-text";
import { ManualApprovedEnrollmentModal } from "./phase-enrollment-actions";

// Reads run through real SWR under a staff session, a fresh cache per render.
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{
        user: { id: "staff-7", scope: "tenant", tenantId: 42 },
        expires: "2099-01-01",
      }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    </SessionProvider>
  );
}

const TITLE = "Kind manuell über Anmeldung freigeben";
const SUBMIT = "Kind anlegen und freigeben";
const SUCCESS = "Die manuelle Anmeldung wurde angelegt und freigegeben.";
const phase = { id: "5", name: "Schuljahr 2026/27" } as Phase;

function Modal({ isOpen = true }: { isOpen?: boolean }) {
  return (
    <ManualApprovedEnrollmentModal
      isOpen={isOpen}
      onClose={vi.fn()}
      phase={phase}
      gradeLevelMax={13}
    />
  );
}

async function fillAndSend() {
  fireEvent.change(await screen.findByLabelText("Interner Grund"), {
    target: { value: "telefonisch bestätigt" },
  });
  fireEvent.click(
    screen.getByLabelText("Einwilligung der Eltern liegt extern vor."),
  );
  const submit = await screen.findByRole("button", { name: SUBMIT });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mocks.createManualApprovedEnrollment).toHaveBeenCalled(),
  );
}

describe("ManualApprovedEnrollmentModal: Senden sperrt das Panel (#6593)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchManualEnrollmentBootstrap.mockResolvedValue({
      schema: schema(),
      offerings: [],
      care_offering_selection_mode: "optional",
      captcha_config: null,
      legal_texts: { blocks: [] },
    });
    mocks.fetchCareOfferingBookingStats.mockResolvedValue({});
  });

  it("locks the panel while sending and unlocks it after a failure", async () => {
    const answer = deferred<{ status_url: string }>();
    mocks.createManualApprovedEnrollment.mockReturnValue(answer.promise);
    render(<Modal />, { wrapper: Providers });
    await fillAndSend();

    expectSlideOverSaveLocked(TITLE, []);

    await act(async () => {
      answer.reject(new ApiError("kaputt", 500, { code: "general.server" }));
    });

    expect(await screen.findByText("Senden fehlgeschlagen")).toBeVisible();
    expectSlideOverUnlocked(TITLE);
    expect(screen.getByLabelText("Interner Grund")).toHaveValue(
      "telefonisch bestätigt",
    );
  });

  it("stays locked while the office answers the question and shows the result", async () => {
    mocks.createManualApprovedEnrollment
      .mockRejectedValueOnce(
        new ApiError("possibly enrolled", 409, {
          code: "enrollment.child_possibly_enrolled",
          details: {
            candidates: [
              { student_id: "77", first_name: "Mia", last_name: "Muster" },
            ],
          },
        }),
      )
      .mockResolvedValueOnce({ status_url: "/anmeldung/status/abc" });
    render(<Modal />, { wrapper: Providers });
    await fillAndSend();

    expect(
      await screen.findByRole("dialog", {
        name: "Ist das Kind schon angemeldet?",
      }),
    ).toBeInTheDocument();
    expectSlideOverSaveLocked(TITLE, []);

    fireEvent.click(
      screen.getByRole("button", { name: /Als neues Kind anlegen/ }),
    );

    expect(await screen.findByText(SUCCESS)).toBeVisible();
    expectSlideOverUnlocked(TITLE);
    expect(mocks.createManualApprovedEnrollment).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({ create_new_student: true }),
    );
  });

  it("shows no success of a late answer in a panel opened again", async () => {
    const answer = deferred<{ status_url: string }>();
    mocks.createManualApprovedEnrollment.mockReturnValue(answer.promise);
    const { rerender } = render(<Modal />, { wrapper: Providers });
    await fillAndSend();

    rerender(<Modal isOpen={false} />);
    rerender(<Modal />);
    // Anker: das neu geöffnete Panel ist geladen und leer.
    expect(await screen.findByRole("button", { name: SUBMIT })).toBeEnabled();
    expect(screen.getByLabelText("Interner Grund")).toHaveValue("");

    await act(async () => {
      answer.resolve({ status_url: "/anmeldung/status/alt" });
    });
    await waitFor(() => expect(mocks.submitSettled).toHaveBeenCalledOnce());

    expectSlideOverUnlocked(TITLE);
    expect(screen.queryByText(SUCCESS)).not.toBeInTheDocument();
  });

  it("waits for this opening's template instead of the cached one", async () => {
    const offering = (name: string) => ({
      id: name,
      name,
      days_of_week_mode: "fixed",
      available_days: [],
      includes_holiday_care: false,
      includes_lunch: false,
    });
    const bootstrap = (name: string) => ({
      schema: schema(),
      offerings: [offering(name)],
      care_offering_selection_mode: "optional",
      captcha_config: null,
      legal_texts: { blocks: [] },
    });
    const second = deferred<ReturnType<typeof bootstrap>>();
    mocks.fetchManualEnrollmentBootstrap
      .mockResolvedValueOnce(bootstrap("Frühbetreuung"))
      .mockReturnValueOnce(second.promise);
    const { rerender } = render(<Modal />, { wrapper: Providers });
    expect(await screen.findByText("Angebot Frühbetreuung")).toBeVisible();

    rerender(<Modal isOpen={false} />);
    rerender(<Modal />);
    expect(
      await screen.findByText("Formularvorlage wird geladen..."),
    ).toBeVisible();
    expect(screen.queryByText("Angebot Frühbetreuung")).not.toBeInTheDocument();

    await act(async () => {
      second.resolve(bootstrap("Spätbetreuung"));
    });
    expect(await screen.findByText("Angebot Spätbetreuung")).toBeVisible();
    expect(screen.queryByText("Angebot Frühbetreuung")).not.toBeInTheDocument();
  });

  it("shows the failed load of a reopened panel instead of the old template", async () => {
    mocks.fetchManualEnrollmentBootstrap
      .mockResolvedValueOnce({
        schema: schema(),
        offerings: [],
        care_offering_selection_mode: "optional",
        captcha_config: null,
        legal_texts: { blocks: [] },
      })
      .mockRejectedValueOnce(
        new ApiError("kaputt", 500, { code: "general.server" }),
      );
    const { rerender } = render(<Modal />, { wrapper: Providers });
    expect(await screen.findByRole("button", { name: SUBMIT })).toBeVisible();

    rerender(<Modal isOpen={false} />);
    rerender(<Modal />);
    expect(
      await screen.findByText(catalogText("general.server", "das Formular")),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: SUBMIT }),
    ).not.toBeInTheDocument();
  });
});
