// #6533: Schließen während des Speicherns ist gesperrt, eine späte Antwort
// schließt keinen anderen Dialog. Echter FormModal.
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchActivity,
  updateActivity,
  type Activity,
} from "~/lib/activity-api";
import { SWRConfig } from "~/lib/swr/testing";
import { ApiError } from "~/lib/api-error";
import {
  deferred,
  expectDialogUnlocked,
  expectSaveLocksDialog,
} from "~/test/helpers/form-modal-pending";

vi.mock("./activity-waitlist-section", () => ({
  ActivityWaitlistSection: () => null,
}));
vi.mock("~/lib/activity-api", () => ({
  fetchActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));
vi.unmock("swr");

// Real SWR with a fresh cache and a signed-in OGS session per render: the
// dialog reads the activity it saves (ADR 0311), `fetchActivity` answers
// with the stored state of the row and its version.
function render(...[ui, options]: Parameters<typeof rtlRender>) {
  return rtlRender(ui, {
    ...options,
    wrapper: ({ children }: Readonly<{ children: ReactNode }>) => (
      <SessionProvider
        session={{ user: { id: "1", scope: "tenant" }, expires: "2099-01-01" }}
        refetchOnWindowFocus={false}
      >
        <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
          {children}
        </SWRConfig>
      </SessionProvider>
    ),
  });
}

const { setForm } = vi.hoisted(() => ({ setForm: vi.fn() }));
vi.mock("~/hooks/useActivityForm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hooks/useActivityForm")>()),
  useActivityForm: vi.fn(() => ({
    form: { name: "Test Activity", category_id: "1", max_participants: "15" },
    setForm,
    categories: [{ id: "1", name: "Category 1" }],
    loading: false,
    loadError: null,
    handleInputChange: vi.fn(),
    validateForm: vi.fn(() => null),
  })),
}));

import { ActivityManagementModal } from "./activity-management-modal";

const TITLE = "Aktivität: Test Activity";
const activity: Activity = {
  id: "1",
  name: "Test Activity",
  ag_category_id: "1",
  max_participant: 15,
  is_open_ags: true,
  supervisor_id: "1",
  created_at: new Date(),
  updated_at: new Date(),
  supervisors: [
    { id: "1", staff_id: "1", is_primary: true, full_name: "John Doe" },
  ],
};
const storedActivity: Activity = { ...activity, version: "v1" };

async function renderAndSave() {
  const answer = deferred<Activity>();
  vi.mocked(updateActivity).mockReturnValue(answer.promise);
  vi.mocked(fetchActivity).mockResolvedValue(storedActivity);
  const onClose = vi.fn();
  const view = render(
    <ActivityManagementModal isOpen onClose={onClose} activity={activity} />,
  );
  // Saving waits for the read of the stored activity (ADR 0311).
  const save = screen.getByRole("button", { name: "Speichern" });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  return { ...view, answer, onClose };
}

describe("ActivityManagementModal pending lock (#6533)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the dialog shut while saving and unlocks it after a failure", async () => {
    const { answer, onClose } = await renderAndSave();

    expectSaveLocksDialog(TITLE);

    await act(async () => {
      answer.reject(new ApiError("kaputt", 500, { code: "general.server" }));
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectDialogUnlocked(TITLE);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes nothing when the answer arrives after unmount", async () => {
    const { answer, onClose, rerender } = await renderAndSave();
    expect(updateActivity).toHaveBeenCalledOnce();

    // The dialog goes, the app's cache stays (as the app's SWRConfig does).
    rerender(<></>);
    await act(async () => {
      answer.resolve(activity);
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
