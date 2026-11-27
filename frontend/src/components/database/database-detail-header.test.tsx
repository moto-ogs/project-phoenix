import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DatabaseDetailHeader } from "./database-detail-header";

describe("DatabaseDetailHeader", () => {
  it("renders the icon, title, and subtitle", () => {
    render(
      <DatabaseDetailHeader
        icon={<span data-testid="detail-icon" />}
        title="Mathe AG"
        subtitle="Sport"
      />,
    );

    expect(screen.getByTestId("detail-icon")).toBeInTheDocument();
    expect(screen.getByText("Mathe AG")).toBeInTheDocument();
    expect(screen.getByText("Sport")).toBeInTheDocument();
  });

  it("renders provided actions in the trailing slot", () => {
    render(
      <DatabaseDetailHeader
        icon={<span />}
        title="Raum 101"
        subtitle="Hauptgebäude"
        actions={<button type="button">Löschen</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Löschen" })).toBeInTheDocument();
  });
});
