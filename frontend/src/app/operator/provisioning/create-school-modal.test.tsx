import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateSchool } = vi.hoisted(() => ({
  mockCreateSchool: vi.fn(),
}));

vi.mock("~/lib/operator/provisioning-api", () => ({
  operatorProvisioningService: { createSchool: mockCreateSchool },
}));

import { ToastProvider } from "~/contexts/ToastContext";
import type { Organization } from "~/lib/operator/provisioning-helpers";
import { CreateSchoolModal } from "./create-school-modal";

const organizations = [
  { id: "7", name: "SJR Pforzheim" },
] as unknown as Organization[];

function renderModal() {
  const onCreated = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <CreateSchoolModal
        isOpen
        onClose={onClose}
        organizations={organizations}
        onCreated={onCreated}
      />
    </ToastProvider>,
  );
  fireEvent.change(screen.getByLabelText(/^Name/), {
    target: { value: "OGS Ispringen" },
  });
  fireEvent.change(screen.getByLabelText(/^E-Mail/), {
    target: { value: "ogs@ispringen.example" },
  });
  return { onCreated, onClose };
}

// The federal state has no default (#7174): holidays and school vacations
// follow it, so the operator names it for every new school.
describe("CreateSchoolModal", () => {
  beforeEach(() => {
    mockCreateSchool.mockReset();
  });

  it("does not create a school without a federal state", () => {
    renderModal();

    const create = screen.getByRole("button", { name: "Erstellen" });
    expect(create).toBeDisabled();
    fireEvent.submit(
      create.closest("form") ?? document.getElementById("create-school-form")!,
    );

    expect(mockCreateSchool).not.toHaveBeenCalled();
    expect(
      screen.getByText("Bitte wähle das Bundesland aus."),
    ).toBeInTheDocument();
  });

  it("sends the chosen federal state with the school", async () => {
    mockCreateSchool.mockResolvedValue({ id: "42" });
    const { onCreated } = renderModal();

    fireEvent.click(screen.getByLabelText(/^Bundesland/));
    fireEvent.click(screen.getByRole("option", { name: "Baden-Württemberg" }));
    fireEvent.click(screen.getByRole("button", { name: "Erstellen" }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith("ogs-ispringen"),
    );
    expect(mockCreateSchool).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "7",
        name: "OGS Ispringen",
        email: "ogs@ispringen.example",
        federal_state: "DE-BW",
      }),
    );
  });

  // Every school has a contact address (#7434).
  it.each(["", "   "])(
    "does not create a school without a contact email (%j)",
    (email) => {
      renderModal();
      fireEvent.change(screen.getByLabelText(/^E-Mail/), {
        target: { value: email },
      });
      fireEvent.click(screen.getByLabelText(/^Bundesland/));
      fireEvent.click(
        screen.getByRole("option", { name: "Baden-Württemberg" }),
      );

      expect(screen.getByLabelText(/^E-Mail/)).toBeRequired();
      expect(screen.getByRole("button", { name: "Erstellen" })).toBeDisabled();
      fireEvent.submit(document.getElementById("create-school-form")!);

      expect(mockCreateSchool).not.toHaveBeenCalled();
      expect(
        screen.getByText("Bitte gib die E-Mail-Adresse der Schule ein."),
      ).toBeInTheDocument();
    },
  );
});
