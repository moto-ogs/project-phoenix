import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthProgress } from "./auth-progress";

describe("AuthProgress", () => {
  it("shows the checking spinner without a tile behind it", () => {
    const { container } = render(
      <AuthProgress
        state="checking"
        title="Einen Moment bitte"
        description="moto prüft deine Anmeldung."
      />,
    );

    expect(screen.getByText("Einen Moment bitte")).toBeVisible();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(container.querySelector(".rounded-full")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("confirms the redirect with the green result tile and a running bar", () => {
    const { container } = render(
      <AuthProgress
        state="redirecting"
        title="Anmeldung erfolgreich"
        description="moto öffnet jetzt deine Startseite …"
      />,
    );

    expect(container.querySelector(".rounded-full")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
  });
});
