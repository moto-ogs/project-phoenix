import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LetterBodyField, placeholderNames } from "./letter-body-field";
import type { LetterPlaceholder } from "~/lib/parent-announcements-api";

const PLACEHOLDERS: LetterPlaceholder[] = [
  { name: "vorname", label: "Vorname des Kindes", example: "Lina" },
  { name: "gruppe", label: "Gruppe", example: "Füchse" },
];

const { previewLetter } = vi.hoisted(() => ({ previewLetter: vi.fn() }));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: () => ({ data: PLACEHOLDERS }),
}));

vi.mock("~/lib/parent-announcements-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/parent-announcements-api")>()),
  previewLetter,
}));

function Harness({ initial }: Readonly<{ initial: string }>) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <LetterBodyField
        value={value}
        onChange={setValue}
        previewChildren={[
          { value: "7", label: "Lina Muster (Klasse 1a)" },
          { value: "8", label: "Emil Weber (Klasse 1a)" },
        ]}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

beforeEach(() => {
  previewLetter.mockReset();
});

describe("LetterBodyField", () => {
  it("inserts a placeholder where the person writes", async () => {
    render(<Harness initial="Liebe Eltern von , bis bald" />);
    const field = screen.getByLabelText("Text") as HTMLTextAreaElement;
    field.setSelectionRange(17, 17);
    fireEvent.select(field);

    fireEvent.click(screen.getByRole("button", { name: /Vorname des Kindes/ }));

    expect(screen.getByTestId("value")).toHaveTextContent(
      "Liebe Eltern von {{vorname}}, bis bald",
    );
  });

  it("warns about a placeholder moto does not know and shows no preview", () => {
    render(
      <Harness initial="Hallo {{vorname}}, bitte {{Allergien}} angeben." />,
    );

    expect(
      screen.getByText(
        "Diesen Platzhalter kennt moto nicht: {{allergien}}. Bitte nehmen Sie nur Platzhalter aus der Liste.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Vorschau des Briefs" }),
    ).not.toBeInTheDocument();
    expect(previewLetter).not.toHaveBeenCalled();
  });

  it("previews the letter for the first child and for the one chosen", async () => {
    previewLetter.mockImplementation(async (_body: string, id: string) => ({
      body:
        id === "7" ? "Hallo Lina aus den Füchsen" : "Hallo Emil aus den Igeln",
      child: {
        student_id: id,
        first_name: "",
        last_name: "",
        school_class: "1a",
      },
    }));
    render(<Harness initial="Hallo {{vorname}} aus den {{gruppe}}" />);

    expect(
      await screen.findByText("Hallo Lina aus den Füchsen"),
    ).toBeInTheDocument();
    expect(previewLetter).toHaveBeenLastCalledWith(
      "Hallo {{vorname}} aus den {{gruppe}}",
      "7",
    );
  });

  it("shows no preview while the text names nobody", async () => {
    render(<Harness initial="Liebe Eltern, am Freitag ist Sommerfest." />);
    expect(screen.getByRole("button", { name: /Gruppe/ })).toBeInTheDocument();
    await waitFor(() => expect(previewLetter).not.toHaveBeenCalled());
    expect(
      screen.queryByRole("region", { name: "Vorschau des Briefs" }),
    ).not.toBeInTheDocument();
  });
});

describe("placeholderNames", () => {
  it("lists each placeholder once in lower case", () => {
    expect(placeholderNames("{{ Vorname }} {{vorname}} {{abholzeit}}")).toEqual(
      ["vorname", "abholzeit"],
    );
  });
});
