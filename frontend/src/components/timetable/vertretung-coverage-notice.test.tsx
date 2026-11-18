import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  VertretungCoverageNotice,
  buildCoverageNoticeMessage,
} from "./vertretung-coverage-notice";

describe("buildCoverageNoticeMessage", () => {
  it("formuliert einen einzelnen Einsatz im Singular", () => {
    expect(buildCoverageNoticeMessage(1)).toBe(
      "Bei 1 Einsatz fehlt die passende Schicht im Dienstplan.",
    );
  });

  it("formuliert mehrere Einsätze im Plural", () => {
    expect(buildCoverageNoticeMessage(3)).toBe(
      "Bei 3 Einsätzen fehlt die passende Schicht im Dienstplan.",
    );
  });
});

describe("VertretungCoverageNotice", () => {
  it("rendert nichts ohne nicht abgedeckte Einsätze", () => {
    const { container } = render(
      <VertretungCoverageNotice
        count={0}
        dienstplanHref="/acme/dienstplan?d=2026-07-15"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("verlinkt mit 'Dienstplan öffnen' auf den Dienstplan", () => {
    render(
      <VertretungCoverageNotice
        count={2}
        dienstplanHref="/acme/dienstplan?d=2026-07-15"
      />,
    );

    expect(
      screen.getByText(
        "Bei 2 Einsätzen fehlt die passende Schicht im Dienstplan.",
      ),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Dienstplan öffnen" });
    expect(link).toHaveAttribute("href", "/acme/dienstplan?d=2026-07-15");
  });

  it("meldet höflich, nicht assertiv — es ist keine Störung", () => {
    render(
      <VertretungCoverageNotice count={1} dienstplanHref="/acme/dienstplan" />,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("legt einen weißen Unterbau unter die getönte Fläche", () => {
    const { container } = render(
      <VertretungCoverageNotice count={1} dienstplanHref="/acme/dienstplan" />,
    );

    // Ohne ihn schiene das Punktraster der Planungsseiten durch den Hinweis.
    expect(container.firstElementChild?.className).toContain("bg-white");
  });
});
