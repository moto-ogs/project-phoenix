import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ForbiddenPage } from "./forbidden-page";

describe("ForbiddenPage", () => {
  it("traegt als ganze Seite denselben Kopf wie jede andere Seite", () => {
    render(<ForbiddenPage />);

    expect(
      screen.getByRole("heading", { name: "Kein Zugriff" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Dir fehlt eine Berechtigung")).toBeInTheDocument();
    expect(
      screen.getByText("Bitte wende dich an deine Leitung."),
    ).toBeInTheDocument();
  });

  it("renders with custom title", () => {
    render(
      <ForbiddenPage
        title="Keine Berechtigung"
        info="Hier stehen die geschützten Angaben."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Keine Berechtigung" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Erklärung zu Keine Berechtigung" }),
    ).toBeInTheDocument();
  });

  it("renders with custom message", () => {
    render(
      <ForbiddenPage message="Du darfst die Datenverwaltung nicht aufrufen." />,
    );

    expect(
      screen.getByText("Du darfst die Datenverwaltung nicht aufrufen."),
    ).toBeInTheDocument();
  });

  it("zeigt die Sperre ruhig, nicht als roten Alarm", () => {
    const { container } = render(<ForbiddenPage />);

    // Kein Zugriff ist ein Zustand, kein Fehler: Schlosssymbol in Grau
    // statt Warndreieck in Signalrot.
    expect(container.querySelector("svg")).toBeInTheDocument();
    // Rot als Symbolfarbe erscheint als Grundton oder als -strong-Stufe
    // (rote IconTile seit #6666).
    expect(
      container.querySelector(".text-moto-red, .text-moto-red-strong"),
    ).toBeNull();
  });

  it("laesst den Seitenkopf weg, wenn die Seite ihn schon hat", () => {
    render(<ForbiddenPage embedded />);

    expect(screen.getByText("Dir fehlt eine Berechtigung")).toBeInTheDocument();
  });
});
