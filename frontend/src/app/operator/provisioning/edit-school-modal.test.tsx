import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUpdateSchool, mockLoggerError } = vi.hoisted(() => ({
  mockUpdateSchool: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("~/components/ui/modal", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: ReactNode;
    footer?: ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {children}
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock("~/lib/operator/provisioning-api", () => ({
  operatorProvisioningService: {
    updateSchool: (...args: unknown[]) => mockUpdateSchool(...args),
  },
}));

vi.mock("~/lib/operator/provisioning-helpers", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/lib/operator/provisioning-helpers")
    >();
  return {
    ...actual,
  };
});

vi.mock("~/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
  }),
}));

import { EditSchoolModal } from "./edit-school-modal";
import type { Organization, School } from "~/lib/operator/provisioning-helpers";

const mockOrg: Organization = {
  version: "v-1",
  id: "1",
  name: "Test Org",
  slug: "test-org",
  active: true,
  deletedAt: null,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  testSystem: false,
};

const mockSchool: School = {
  version: "v-1",
  id: "10",
  organizationId: "1",
  name: "Test School",
  slug: "test-school",
  subdomain: "test-school",
  address: "Main St 1",
  city: "Berlin",
  zip: "10115",
  phone: "",
  email: "info@test-school.example",
  active: true,
  hidden: false,
  deletedAt: null,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  organization: mockOrg,
};

describe("EditSchoolModal", () => {
  const onClose = vi.fn();
  const onUpdated = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    onUpdated.mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" })),
    );
  });

  it("renders visibility toggle with Sichtbar when school is not hidden", () => {
    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={mockSchool}
        organizations={[mockOrg]}
        onUpdated={onUpdated}
      />,
    );

    expect(screen.getByText("Sichtbar")).toBeInTheDocument();
    expect(
      screen.getByText(/Schule wird auf der Startseite/),
    ).toBeInTheDocument();
  });

  it("renders visibility toggle with Verborgen when school is hidden", () => {
    const hiddenSchool = { ...mockSchool, hidden: true };
    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={hiddenSchool}
        organizations={[mockOrg]}
        onUpdated={onUpdated}
      />,
    );

    expect(screen.getByText("Verborgen")).toBeInTheDocument();
    expect(screen.getByText(/nicht auf der Startseite/)).toBeInTheDocument();
  });

  it("toggles visibility state when switch is clicked", () => {
    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={mockSchool}
        organizations={[mockOrg]}
        onUpdated={onUpdated}
      />,
    );

    expect(screen.getByText("Sichtbar")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("switch", { name: "Sichtbarkeit umschalten" }),
    );

    expect(screen.getByText("Verborgen")).toBeInTheDocument();
  });

  it("sends hidden=true when saving with visibility toggled off", async () => {
    mockUpdateSchool.mockResolvedValue(mockSchool);

    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={mockSchool}
        organizations={[mockOrg]}
        onUpdated={onUpdated}
      />,
    );

    // Toggle visibility off
    fireEvent.click(
      screen.getByRole("switch", { name: "Sichtbarkeit umschalten" }),
    );

    // Submit
    fireEvent.click(screen.getByText("Speichern"));

    await waitFor(() => {
      expect(mockUpdateSchool).toHaveBeenCalledWith(
        "10",
        expect.objectContaining({
          hidden: true,
          name: "Test School",
        }),
      );
    });
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
  });

  // #6652: the page reloads after the write and outside its catch: a
  // failed reload is no failed change and leaves no retry that saves again.
  it("closes a saved change even when the page reload fails", async () => {
    mockUpdateSchool.mockResolvedValue(mockSchool);
    const updated = vi.fn().mockResolvedValue(false);

    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={mockSchool}
        organizations={[mockOrg]}
        onUpdated={updated}
      />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Sichtbarkeit umschalten" }),
    );
    fireEvent.click(screen.getByText("Speichern"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(updated).toHaveBeenCalledOnce();
    expect(mockUpdateSchool).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/Die Änderung an der Schule/),
    ).not.toBeInTheDocument();
  });

  it("clears an existing contact email", async () => {
    mockUpdateSchool.mockResolvedValue(mockSchool);
    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={mockSchool}
        organizations={[mockOrg]}
        onUpdated={onUpdated}
      />,
    );

    const emailInput = screen.getByLabelText(/E-Mail/);
    expect(emailInput).not.toBeRequired();
    fireEvent.change(emailInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(mockUpdateSchool).toHaveBeenCalledWith(
        "10",
        expect.objectContaining({ email: "" }),
      );
    });
  });

  it.each(["button", "form"])(
    "saves other edits for a school without an email via %s",
    async (submitVia) => {
      mockUpdateSchool.mockResolvedValue(mockSchool);

      render(
        <EditSchoolModal
          reload={vi.fn()}
          isOpen={true}
          onClose={onClose}
          school={{ ...mockSchool, email: "" }}
          organizations={[mockOrg]}
          onUpdated={onUpdated}
        />,
      );

      const emailInput = screen.getByLabelText(/E-Mail/);
      expect(emailInput).toHaveValue("");
      expect(emailInput).not.toBeRequired();
      fireEvent.change(screen.getByLabelText(/Name/), {
        target: { value: "Updated School" },
      });
      const saveButton = screen.getByRole("button", { name: "Speichern" });
      expect(saveButton).toBeEnabled();

      if (submitVia === "button") {
        fireEvent.click(saveButton);
      } else {
        fireEvent.submit(emailInput.closest("form")!);
      }

      await waitFor(() => {
        expect(mockUpdateSchool).toHaveBeenCalledWith(
          "10",
          expect.objectContaining({ name: "Updated School", email: "" }),
        );
      });
      await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
      expect(onClose).toHaveBeenCalledOnce();
    },
  );

  it("warns at the email field while the reply address is missing (#7174)", () => {
    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={{ ...mockSchool, email: "" }}
        organizations={[mockOrg]}
        onUpdated={onUpdated}
        requiredDetails={{ schoolId: "10", replyAddressMissing: true }}
      />,
    );

    expect(
      screen.getByText(
        "Adresse fehlt. Antworten von Eltern kommen bei der Schule nicht an.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/E-Mail/), {
      target: { value: "info@schule.example" },
    });
    expect(
      screen.getByText("Antworten von Eltern gehen an diese Adresse."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Adresse fehlt/)).not.toBeInTheDocument();
  });

  it("keeps the plain hint for a school whose replies arrive", () => {
    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={mockSchool}
        organizations={[mockOrg]}
        onUpdated={onUpdated}
        requiredDetails={{ schoolId: "10", replyAddressMissing: false }}
      />,
    );

    expect(
      screen.getByText("Antworten von Eltern gehen an diese Adresse."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Adresse fehlt/)).not.toBeInTheDocument();
  });

  it("sends hidden=false when school is visible", async () => {
    mockUpdateSchool.mockResolvedValue(mockSchool);

    render(
      <EditSchoolModal
        reload={vi.fn()}
        isOpen={true}
        onClose={onClose}
        school={mockSchool}
        organizations={[mockOrg]}
        onUpdated={onUpdated}
      />,
    );

    // Submit without toggling
    fireEvent.click(screen.getByText("Speichern"));

    await waitFor(() => {
      expect(mockUpdateSchool).toHaveBeenCalledWith(
        "10",
        expect.objectContaining({
          hidden: false,
        }),
      );
    });
  });
});
