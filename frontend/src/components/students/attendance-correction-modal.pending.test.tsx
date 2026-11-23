// #6533: Schließen während der Korrektur ist gesperrt, eine späte Antwort
// schließt keinen anderen Dialog. Echter FormModal.
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import type { ReactNode as TenantSWRNode } from "react";
import { SWRConfig as TenantSWRConfig } from "~/lib/swr/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deferred,
  expectDialogUnlocked,
  expectSaveLocksDialog,
} from "~/test/helpers/form-modal-pending";

import { AttendanceCorrectionModal } from "./attendance-correction-modal";

vi.unmock("swr");

// Real SWR with a fresh cache and a signed-in OGS session per render.
function TenantSWRWrapper({ children }: Readonly<{ children: TenantSWRNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1", scope: "tenant" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <TenantSWRConfig
        value={{ provider: () => new Map(), errorRetryCount: 0 }}
      >
        {children}
      </TenantSWRConfig>
    </SessionProvider>
  );
}

function render(...[ui, options]: Parameters<typeof rtlRender>) {
  const Outer = options?.wrapper;
  return rtlRender(ui, {
    ...options,
    wrapper: ({ children }: Readonly<{ children: TenantSWRNode }>) => (
      <TenantSWRWrapper>
        {Outer ? <Outer>{children}</Outer> : children}
      </TenantSWRWrapper>
    ),
  });
}

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

const slot = {
  instanceId: "instance-1",
  title: "Bastelstunde",
  date: "2026-09-07",
  startTime: "14:00",
  endTime: "15:00",
  status: "present",
  substatus: null,
  note: null,
};

function renderAndSave() {
  const answer = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? answer.promise
        : Response.json({ data: { corrections: [] } }),
    ),
  );
  const onClose = vi.fn();
  const onCorrected = vi.fn();
  const view = render(
    <AttendanceCorrectionModal
      isOpen
      onClose={onClose}
      studentId="student-1"
      slot={slot}
      onCorrected={onCorrected}
    />,
  );
  fireEvent.change(screen.getByLabelText(/Bemerkung/), {
    target: { value: "kam später" },
  });
  fireEvent.change(screen.getByLabelText(/Grund der Korrektur/), {
    target: { value: "Nachtrag" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
  return { ...view, answer, onClose, onCorrected };
}

describe("AttendanceCorrectionModal pending lock (#6533)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the dialog shut while saving and unlocks it after a failure", async () => {
    const { answer, onClose } = renderAndSave();

    expectSaveLocksDialog("Eintrag korrigieren");

    await act(async () => {
      answer.resolve(
        Response.json(
          { status: 500, code: "general.server", detail: "kaputt" },
          { status: 500 },
        ),
      );
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectDialogUnlocked("Eintrag korrigieren");
    expect(screen.getByLabelText(/Grund der Korrektur/)).toHaveValue(
      "Nachtrag",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refreshes the data but closes nothing when the answer arrives after unmount", async () => {
    const { answer, onClose, onCorrected, unmount } = renderAndSave();
    // The POST leaves after the asynchronous session gate.
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/correction"),
        expect.objectContaining({ method: "POST" }),
      ),
    );

    unmount();
    await act(async () => {
      answer.resolve(Response.json({ data: {} }));
    });

    expect(onCorrected).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
