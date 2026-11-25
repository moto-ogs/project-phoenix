import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { childrenConcept } from "~/lib/concepts/children";
import { TINT_CLASSES } from "~/lib/kit-palette";

import { ConceptIconTile } from "./concept-icon-tile";
import { IconTile } from "./icon-tile";

describe("IconTile", () => {
  it("zeigt das übergebene Symbol", () => {
    render(<IconTile icon={<svg role="img" aria-label="Glocke" />} />);

    expect(screen.getByRole("img", { name: "Glocke" })).toBeInTheDocument();
  });

  it("reicht data- und aria-Attribute an die Kachel durch", () => {
    render(
      <IconTile
        icon={<svg aria-hidden="true" />}
        data-testid="kachel"
        aria-hidden="true"
      />,
    );

    expect(screen.getByTestId("kachel")).toHaveAttribute("aria-hidden", "true");
  });

  it("passt die Statusanzeige am Seitenkopf an die verfügbare Breite an", () => {
    render(
      <IconTile
        icon={<svg aria-hidden="true" />}
        size="hero"
        data-testid="statusanzeige"
      />,
    );

    expect(screen.getByTestId("statusanzeige")).toHaveClass(
      "h-12",
      "w-12",
      "sm:h-14",
      "sm:w-14",
      "[&>svg]:size-7",
    );
  });

  // Alle getönten Kacheln zeichnen das Symbol in derselben Stufe (#6666).
  it.each(["blue", "green", "orange", "red"] as const)(
    "färbt das Symbol bei %s in der Textstufe der Palette",
    (tone) => {
      render(
        <IconTile
          icon={<svg aria-hidden="true" />}
          tone={tone}
          data-testid="kachel"
        />,
      );

      expect(screen.getByTestId("kachel")).toHaveClass(TINT_CLASSES[tone].text);
    },
  );
});

describe("ConceptIconTile", () => {
  it("zeigt das Symbol des Konzepts im Ton des Konzepts", () => {
    const { container } = render(
      <ConceptIconTile concept={childrenConcept} size="section" />,
    );

    expect(
      container.querySelector('[data-moto-duotone-tone="greenVivid"]'),
    ).toBeInTheDocument();
  });

  it("übernimmt einen abweichenden Symbolton", () => {
    const { container } = render(
      <ConceptIconTile
        concept={childrenConcept}
        size="page"
        iconTone="neutral"
      />,
    );

    expect(
      container.querySelector('[data-moto-duotone-tone="neutral"]'),
    ).toBeInTheDocument();
  });
});
