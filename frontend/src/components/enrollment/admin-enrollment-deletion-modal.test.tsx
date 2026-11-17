import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it("decides a reopened dialog on its own preview, not the earlier one", async () => {
    let answerSecond!: (value: AdminEnrollmentDeletionImpact) => void;
    mocks.getAdminRequestDeleteImpact
      .mockResolvedValueOnce(impact)
      .mockReturnValueOnce(
        new Promise<AdminEnrollmentDeletionImpact>((resolve) => {
          answerSecond = resolve;
        }),
      );
    const { rerender } = renderModal();
    expect(await screen.findByLabelText(/Löschgrund/)).toBeVisible();

    rerender(<Modal isOpen={false} />);
    rerender(<Modal isOpen />);
    expect(
      await screen.findByText("Auswirkungen werden geladen…"),
    ).toBeVisible();
    expect(screen.queryByLabelText(/Löschgrund/)).not.toBeInTheDocument();

    await act(async () => {
      answerSecond({
        ...impact,
        can_delete: false,
        blocking_student_ids: ["9"],
      } as AdminEnrollmentDeletionImpact);
    });
    expect(await screen.findByText("Löschung blockiert")).toBeVisible();
    expect(screen.queryByLabelText(/Löschgrund/)).not.toBeInTheDocument();
  });
});
