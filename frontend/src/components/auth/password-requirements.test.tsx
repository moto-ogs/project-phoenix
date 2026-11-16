import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PasswordRequirements } from "./password-requirements";

describe("PasswordRequirements (#7114)", () => {
  it("nennt den Stand jeder Regel als Text, nicht nur als Symbol", () => {
    render(
      <PasswordRequirements
        requirements={[
          { label: "Mindestens 8 Zeichen", met: true },
          { label: "Eine Zahl", met: false },
        ]}
      />,
    );

    const list = screen.getByRole("list", { name: "Passwortanforderungen" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Mindestens 8 Zeichen: erfüllt");
    expect(items[1]).toHaveTextContent("Eine Zahl: noch nicht erfüllt");
  });

  it("übernimmt übersetzte Stände", () => {
    render(
      <PasswordRequirements
        title="Password requirements"
        metLabel="met"
        unmetLabel="not met yet"
        requirements={[{ label: "One number", met: false }]}
      />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(
      "One number: not met yet",
    );
  });
});
