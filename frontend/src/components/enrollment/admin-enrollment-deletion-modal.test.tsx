import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "~/lib/swr/testing";

vi.unmock("swr");

const mocks = vi.hoisted(() => ({
  deleteAdminRequest: vi.fn(),
  getAdminRequestDeleteImpact: vi.fn(),
}));

vi.mock("~/lib/enrollment-admin-api", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    deleteAdminRequest: mocks.deleteAdminRequest,
    getAdminRequestDeleteImpact: mocks.getAdminRequestDeleteImpact,
  };
});

import { AdminEnrollmentDeletionModal } from "./admin-enrollment-deletion-modal";
import { ApiError } from "~/lib/api-error";
import type { AdminEnrollmentDeletionImpact } from "~/lib/enrollment-admin-api";
import { catalogText } from "~/test/error-catalog-text";

const impact = {
  fingerprint: "shown",
  can_delete: true,
  deletes_request: true,
  blocking_student_ids: [],
  preserved_guardian_profiles: 0,
  preserved_parent_accounts: 0,
  unlinked_guardian_profiles: 0,
  parent_accounts_without_students: 0,
  counts: {
    total: 1,
    requests: 1,
    request_children: 0,
    request_child_offerings: 0,
    request_guardians: 0,
    change_requests: 0,
    change_request_messages: 0,
    late_invites: 0,
    offering_adjustments: 0,
    email_outbox: 0,
    rollover_links_cleared: 0,
    student_source_links_cleared: 0,
  },
} as unknown as AdminEnrollmentDeletionImpact;

function renderModal() {
  return render(<Modal isOpen />);
}

function Modal({ isOpen }: Readonly<{ isOpen: boolean }>) {
  return (
    <SessionProvider
      session={{
        user: { id: "staff-7", scope: "tenant", tenantId: 42 },
        expires: "2099-01-01",
      }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        <AdminEnrollmentDeletionModal
          isOpen={isOpen}
          requestId="7"
          studentHref={(id) => `/students/${id}`}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </SWRConfig>
    </SessionProvider>
  );
}

describe("AdminEnrollmentDeletionModal (#2515)", () => {
  beforeEach(() => {
    mocks.deleteAdminRequest.mockReset();
    mocks.getAdminRequestDeleteImpact.mockReset();
  });

  it("shows a failed preview in the dialog with a retry", async () => {
    mocks.getAdminRequestDeleteImpact
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce(impact);

    renderModal();

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Vorschau der Löschung"),
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    expect(await screen.findByText("Betroffene Datensätze (1)")).toBeVisible();
    expect(mocks.getAdminRequestDeleteImpact).toHaveBeenCalledTimes(2);
  });

  // ADR 0311: the deletion confirms the preview on screen through its
  // fingerprint; a changed impact is refused, and the dialog then shows the
  // new preview and the refusal, without offering the same request again.
  it("deletes with the preview's fingerprint and shows a changed impact", async () => {
    mocks.getAdminRequestDeleteImpact
      .mockResolvedValueOnce(impact)
      .mockResolvedValueOnce({
        ...impact,
        fingerprint: "after",
        counts: { ...impact.counts, total: 2, request_children: 1 },
      } as AdminEnrollmentDeletionImpact);
    mocks.deleteAdminRequest.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    renderModal();

    fireEvent.change(await screen.findByLabelText(/Löschgrund/), {
      target: { value: "Testanmeldung" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Vorschau der Löschung"),
      ),
    ).toBeVisible();
    expect(mocks.deleteAdminRequest).toHaveBeenCalledWith(
      "7",
      "Testanmeldung",
      "shown",
    );
    expect(await screen.findByText("Betroffene Datensätze (2)")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();
  });

  it("deletes with the preview it opened with while a newer read arrives", async () => {
    let answerOwn!: (next: AdminEnrollmentDeletionImpact) => void;
    mocks.getAdminRequestDeleteImpact
      .mockResolvedValueOnce(impact)
      .mockReturnValueOnce(
        new Promise<AdminEnrollmentDeletionImpact>((resolve) => {
          answerOwn = resolve;
        }),
      );
    mocks.deleteAdminRequest.mockResolvedValueOnce(impact);
    const view = renderModal();
    expect(await screen.findByText("Betroffene Datensätze (1)")).toBeVisible();
    view.rerender(<Modal isOpen={false} />);
    view.rerender(<Modal isOpen />);

    // The cached preview shows at once; this opening's read answers later.
    fireEvent.change(await screen.findByLabelText(/Löschgrund/), {
      target: { value: "Testanmeldung" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    // Each opening reads the preview anew.
    await waitFor(() =>
      expect(mocks.getAdminRequestDeleteImpact).toHaveBeenCalledTimes(2),
    );
    await act(async () => {
      answerOwn({
        ...impact,
        fingerprint: "after",
        counts: { ...impact.counts, total: 2, request_children: 1 },
      } as AdminEnrollmentDeletionImpact);
    });
    expect(screen.getByText("Betroffene Datensätze (1)")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() =>
      expect(mocks.deleteAdminRequest).toHaveBeenCalledWith(
        "7",
        "Testanmeldung",
        "shown",
      ),
    );
  });

  // Without the new preview the dialog names the failed read, not a new
  // preview it does not have; its retry reads again and then names the
  // refusal. Nothing is deleted twice.
  it("names a failed preview read after a refused deletion", async () => {
    mocks.getAdminRequestDeleteImpact
      .mockResolvedValueOnce(impact)
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValueOnce({
        ...impact,
        fingerprint: "after",
        counts: { ...impact.counts, total: 2, request_children: 1 },
      } as AdminEnrollmentDeletionImpact);
    mocks.deleteAdminRequest.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    renderModal();

    fireEvent.change(await screen.findByLabelText(/Löschgrund/), {
      target: { value: "Testanmeldung" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    expect(
      await screen.findByText(
        // ADR 0311: the failed read after a refusal says that the new state
        // is missing, before the load error itself.
        `Der neue Stand konnte nicht geladen werden. ${catalogText("general.unavailable", "die Vorschau der Löschung")}`,
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(
        catalogText("general.changed_since_read", "die Vorschau der Löschung"),
      ),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Vorschau der Löschung"),
      ),
    ).toBeVisible();
    expect(await screen.findByText("Betroffene Datensätze (2)")).toBeVisible();
    expect(mocks.deleteAdminRequest).toHaveBeenCalledOnce();
  });
});
