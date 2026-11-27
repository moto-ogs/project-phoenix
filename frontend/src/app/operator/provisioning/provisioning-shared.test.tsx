import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  FormField,
  FieldWarning,
  DeliveryStatusBadge,
  ProvisioningEmptyState,
  SimpleEmptyState,
  PlusIcon,
} from "./provisioning-shared";

describe("FormField", () => {
  // #2519: a field error from the shared error path stays at the field.
  it("ties a field error to the control", () => {
    render(
      <FormField
        label="Slug"
        htmlFor="org-slug"
        error="Bitte prüfe dieses Feld."
      >
        <input id="org-slug" name="slug" />
      </FormField>,
    );

    const input = screen.getByLabelText("Slug");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "org-slug-error");
    expect(screen.getByText("Bitte prüfe dieses Feld.")).toHaveAttribute(
      "id",
      "org-slug-error",
    );
  });

  it("leaves the control untouched without an error", () => {
    render(
      <FormField label="Slug" htmlFor="org-slug">
        <input id="org-slug" name="slug" />
      </FormField>,
    );

    const input = screen.getByLabelText("Slug");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("should render label text", () => {
    render(
      <FormField label="Email" htmlFor="email">
        <input id="email" />
      </FormField>,
    );

    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("should set htmlFor on label", () => {
    render(
      <FormField label="Email" htmlFor="email-field">
        <input id="email-field" />
      </FormField>,
    );

    const label = screen.getByText("Email");
    expect(label).toHaveAttribute("for", "email-field");
  });

  it("should render required indicator when required is true", () => {
    render(
      <FormField label="Name" htmlFor="name" required>
        <input id="name" />
      </FormField>,
    );

    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("should not render required indicator when required is false", () => {
    render(
      <FormField label="Name" htmlFor="name">
        <input id="name" />
      </FormField>,
    );

    // Anker: das Label, an dem der Pflichtstern hängt, ist gerendert.
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("should render children", () => {
    render(
      <FormField label="Field" htmlFor="field">
        <input data-testid="child-input" />
      </FormField>,
    );

    expect(screen.getByTestId("child-input")).toBeInTheDocument();
  });
});

describe("FieldWarning", () => {
  it("should render warning message", () => {
    render(<FieldWarning message="This slug is already taken" />);

    expect(screen.getByText("This slug is already taken")).toBeInTheDocument();
  });
});

describe("DeliveryStatusBadge", () => {
  it("should render 'Gesendet' for sent status", () => {
    render(<DeliveryStatusBadge status="sent" />);

    expect(screen.getByText("Gesendet")).toBeInTheDocument();
  });

  it("should render 'Ausstehend' for pending status", () => {
    render(<DeliveryStatusBadge status="pending" />);

    expect(screen.getByText("Ausstehend")).toBeInTheDocument();
  });

  it("should render 'Fehlgeschlagen' for failed status", () => {
    render(<DeliveryStatusBadge status="failed" />);

    expect(screen.getByText("Fehlgeschlagen")).toBeInTheDocument();
  });

  it("should apply green styling for sent", () => {
    render(<DeliveryStatusBadge status="sent" />);

    expect(screen.getByText("Gesendet")).toHaveStyle({
      backgroundColor: "#EEF9E1",
      color: "#3F6F12",
    });
  });

  it("should apply amber styling for pending", () => {
    render(<DeliveryStatusBadge status="pending" />);

    // #5617: the attention pill is yellow with a warning icon, so it never
    // reads as the orange Schulhof pill.
    const pill = screen.getByText("Ausstehend");
    expect(pill).toHaveStyle({
      backgroundColor: "#FEF9C3",
      color: "#713F12",
    });
    expect(pill.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("should apply red styling for failed", () => {
    render(<DeliveryStatusBadge status="failed" />);

    expect(screen.getByText("Fehlgeschlagen")).toHaveStyle({
      backgroundColor: "#FEF2F2",
      color: "#B91C1C",
    });
  });

  it("should fall back to raw status text for unknown status", () => {
    render(<DeliveryStatusBadge status="unknown_status" />);

    expect(screen.getByText("unknown_status")).toBeInTheDocument();
  });

  it("should fall back for inherited status-map keys", () => {
    render(<DeliveryStatusBadge status="constructor" />);

    expect(screen.getByText("constructor")).toHaveStyle({
      backgroundColor: "#F3F4F6",
      color: "#4B5563",
    });
  });

  it("should apply gray styling for unknown status", () => {
    render(<DeliveryStatusBadge status="something_else" />);

    expect(screen.getByText("something_else")).toHaveStyle({
      backgroundColor: "#F3F4F6",
      color: "#4B5563",
    });
  });
});

describe("ProvisioningEmptyState", () => {
  it("should render title", () => {
    render(
      <ProvisioningEmptyState
        title="No items"
        description="Create your first item"
        buttonLabel="Add"
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("No items")).toBeInTheDocument();
  });

  it("should render description", () => {
    render(
      <ProvisioningEmptyState
        title="No items"
        description="Create your first item"
        buttonLabel="Add"
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Create your first item")).toBeInTheDocument();
  });

  it("should render button with label", () => {
    render(
      <ProvisioningEmptyState
        title="No items"
        description="Description"
        buttonLabel="Add Item"
        onAction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Add Item" }),
    ).toBeInTheDocument();
  });

  it("should call onAction when button is clicked", () => {
    const onAction = vi.fn();

    render(
      <ProvisioningEmptyState
        title="No items"
        description="Description"
        buttonLabel="Add"
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("should render an SVG icon", () => {
    const { container } = render(
      <ProvisioningEmptyState
        title="Empty"
        description="Nothing here"
        buttonLabel="Create"
        onAction={vi.fn()}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });
});

describe("SimpleEmptyState", () => {
  it("should render title", () => {
    render(
      <SimpleEmptyState title="No data" description="Nothing to display" />,
    );

    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("should render description", () => {
    render(
      <SimpleEmptyState title="No data" description="Nothing to display" />,
    );

    expect(screen.getByText("Nothing to display")).toBeInTheDocument();
  });

  it("should not render a button", () => {
    render(
      <SimpleEmptyState title="No data" description="Nothing to display" />,
    );

    // Anker: der leere Zustand ist mit Titel gerendert.
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("PlusIcon", () => {
  it("should render an SVG element", () => {
    const { container } = render(<PlusIcon />);

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should have a path element", () => {
    const { container } = render(<PlusIcon />);

    const path = container.querySelector("path");
    expect(path).toBeInTheDocument();
  });
});
