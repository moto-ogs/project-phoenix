// #6533: Schließen während des Umschaltens ist gesperrt, eine späte Antwort
// verändert keinen neu geöffneten Dialog. Echter FormModal.
import {
  act,
  fireEvent,
  render as renderRaw,
  screen,
  waitFor,
} from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import type { ReactElement, ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");

// Real SWR with a fresh cache and a signed-in session per render.
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1", scope: "tenant" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}

const render = (ui: ReactElement) => renderRaw(ui, { wrapper: Providers });
import {
  deferred,
  expectDialogUnlocked,
  expectSaveLocksDialog,
} from "~/test/helpers/form-modal-pending";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("~/lib/caregiver-capability-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/caregiver-capability-api")>()),
  caregiverCapabilityService: {
    getTenantAccountCapability: mocks.get,
    disableTenantAccountCapability: mocks.disable,
  },
}));

import { CaregiverCapabilityModal } from "./caregiver-capability-modal";

const TITLE = "Betreuung verwalten: Ada Lovelace";

function state(isActiveCaregiver: boolean) {
  return {
    accountId: "42",
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    personId: "10",
    staffId: "20",
    teacherId: "30",
    hasAdminRole: true,
    hasUserRole: true,
    hasPerson: true,
    hasStaff: true,
    hasTeacher: true,
    hasCaregiverProfile: true,
    isActiveCaregiver,
    disableBlocked: false,
    disableBlockers: [],
    activeSupervisions: [],
    activeSubstitutions: [],
    activitySupervisions: [],
    groupAssignments: [],
  };
}

async function renderAndDisable() {
  const answer = deferred<ReturnType<typeof state>>();
  mocks.get.mockResolvedValue(state(true));
  mocks.disable.mockReturnValue(answer.promise);
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  const modal = (isOpen: boolean) => (
    <CaregiverCapabilityModal
      isOpen={isOpen}
      onClose={onClose}
      onUpdated={onUpdated}
      scope="tenant"
      accountId="42"
      accountLabel="Ada Lovelace"
    />
  );
  const view = render(modal(true));
  const disableButton = await screen.findByRole("button", {
    name: "Betreuung deaktivieren",
  });
  await waitFor(() => expect(disableButton).toBeEnabled());
  fireEvent.click(disableButton);
  return { ...view, modal, answer, onClose, onUpdated };
}

describe("CaregiverCapabilityModal pending lock (#6533)", () => {
  beforeAll(async () => {
    await import("~/lib/error-presentation");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the dialog shut while switching and unlocks it after a failure", async () => {
    const { answer, onClose } = await renderAndDisable();

    expectSaveLocksDialog(TITLE, ["Schließen"]);

    await act(async () => {
      answer.reject(new ApiError("kaputt", 500, { code: "general.server" }));
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectDialogUnlocked(TITLE);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves the state of the dialog opened again meanwhile alone", async () => {
    const { answer, modal, rerender, onUpdated } = await renderAndDisable();
    expect(mocks.disable).toHaveBeenCalledOnce();

    rerender(modal(false));
    rerender(modal(true));
    // Anker: der neu geöffnete Dialog hat seinen Stand frisch geladen.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Betreuung deaktivieren" }),
      ).toBeEnabled(),
    );

    await act(async () => {
      answer.resolve(state(false));
    });

    // Die Antwort frischt die Daten beim Aufrufer auf ...
    expect(onUpdated).toHaveBeenCalledOnce();
    // ... überschreibt aber nicht den Stand des neuen Dialogs.
    expect(
      screen.getByRole("button", { name: "Betreuung deaktivieren" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Betreuung aktivieren" }),
    ).not.toBeInTheDocument();
  });
});
