import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LetterBodyField,
  type LetterPreviewChildren,
} from "./letter-body-field";
import type * as sharedContract from "~/lib/contract/shared.generated";
import { unavailableApiError } from "~/lib/api-error";

const PLACEHOLDERS: sharedContract.letterPlaceholderResponse[] = [
  { name: "vorname", label: "Vorname des Kindes", example: "Lina" },
  { name: "gruppe", label: "Gruppe", example: "Füchse" },
];

const { previewLetter, fetchLetterPlaceholders } = vi.hoisted(() => ({
  previewLetter: vi.fn(),
  fetchLetterPlaceholders: vi.fn(),
}));

// A small SWR: loads once per key, keeps the result of the current key and
// loads again on mutate.
vi.mock("~/lib/swr", () => ({
  useSWRAuth: (key: string | null, fetcher: () => Promise<unknown>) => {
    const [state, setState] = useState<{
      key: string | null;
      data?: unknown;
      error?: unknown;
    }>({ key: null });
    const [round, setRound] = useState(0);
    useEffect(() => {
      if (key === null) return;
      let live = true;
      fetcher().then(
        (data) => live && setState({ key, data }),
        (error: unknown) => live && setState({ key, error }),
      );
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- like SWR, the key decides
    }, [key, round]);
    const current: { data?: unknown; error?: unknown } =
      state.key === key ? state : {};
    return {
      data: current.data,
      error: current.error,
      isLoading: key !== null && !("data" in current) && !current.error,
      mutate: () => setRound((r) => r + 1),
    };
  },
}));

vi.mock("~/lib/parent-announcements-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/parent-announcements-api")>()),
  previewLetter,
  fetchLetterPlaceholders,
}));

function children(
  scope: string,
  list: { value: string; label: string }[],
): LetterPreviewChildren {
  return { scope, load: vi.fn(async () => list) };
}

const LINA_AND_EMIL = children("1a", [
  { value: "7", label: "Lina Muster (Klasse 1a)" },
  { value: "8", label: "Emil Weber (Klasse 1a)" },
]);

function Harness({
  initial,
  source = LINA_AND_EMIL,
}: Readonly<{ initial: string; source?: LetterPreviewChildren }>) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <LetterBodyField
        value={value}
        onChange={setValue}
        previewChildren={source}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

beforeEach(() => {
  previewLetter.mockReset();
  previewLetter.mockImplementation(async (_body: string, id: string) => ({
    body: `Brief für Kind ${id}`,
    child: { student_id: id, first_name: "", last_name: "", school_class: "" },
  }));
  fetchLetterPlaceholders.mockReset();
  fetchLetterPlaceholders.mockResolvedValue(PLACEHOLDERS);
});

describe("LetterBodyField", () => {
  it("inserts a placeholder where the person writes", async () => {
    render(<Harness initial="Liebe Eltern von , bis bald" />);
    const field = screen.getByLabelText("Text") as HTMLTextAreaElement;
    // As in the browser: the person places the caret, then the click on the
    // button takes the focus away from the field.
    field.focus();
    field.setSelectionRange(17, 17);
    fireEvent.blur(field);

    fireEvent.click(
      await screen.findByRole("button", { name: /Vorname des Kindes/ }),
    );

    expect(screen.getByTestId("value")).toHaveTextContent(
      "Liebe Eltern von {{vorname}}, bis bald",
    );
  });

  it("warns about what moto does not know, as the backend refuses it, and shows no preview", async () => {
    render(
      <Harness initial="Hallo {{vorname}}, bitte {{Allergien}} und {gruppe}} angeben." />,
    );

    expect(
      await screen.findByText(
        "Diese Platzhalter kennt moto nicht: {{allergien}}, {gruppe}}. Bitte nimm nur Platzhalter aus der Liste.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Vorschau des Briefs" }),
    ).not.toBeInTheDocument();
  });

  it("previews the letter for the first child and for the one chosen", async () => {
    render(<Harness initial="Hallo {{vorname}}" />);

    expect(await screen.findByText("Brief für Kind 7")).toBeInTheDocument();
    expect(previewLetter).toHaveBeenLastCalledWith(
      "Hallo {{vorname}}",
      "7",
      undefined,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: "Kind für die Vorschau" }),
    );
    fireEvent.click(
      screen.getByRole("option", { name: "Emil Weber (Klasse 1a)" }),
    );
    expect(await screen.findByText("Brief für Kind 8")).toBeInTheDocument();
  });

  it("loads the children only once the text names a placeholder", async () => {
    const source = children("school", [{ value: "7", label: "Lina" }]);
    render(
      <Harness
        initial="Liebe Eltern, am Freitag ist Sommerfest."
        source={source}
      />,
    );

    expect(
      await screen.findByRole("button", { name: /Gruppe/ }),
    ).toBeInTheDocument();
    expect(source.load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Gruppe/ }));
    expect(await screen.findByText("Brief für Kind 7")).toBeInTheDocument();
    expect(source.load).toHaveBeenCalledOnce();
  });

  it("replaces a chosen child that the new list no longer holds", async () => {
    const props = { value: "Hallo {{vorname}}", onChange: vi.fn() };
    const view = render(
      <LetterBodyField {...props} previewChildren={LINA_AND_EMIL} />,
    );
    expect(await screen.findByText("Brief für Kind 7")).toBeInTheDocument();
    const picker = screen.getByRole("combobox", {
      name: "Kind für die Vorschau",
    });
    expect(picker).toBeEnabled();
    fireEvent.click(picker);
    fireEvent.click(
      await screen.findByRole("option", { name: "Emil Weber (Klasse 1a)" }),
    );
    expect(await screen.findByText("Brief für Kind 8")).toBeInTheDocument();

    view.rerender(
      <LetterBodyField
        {...props}
        previewChildren={children("2b", [{ value: "9", label: "Mia" }])}
      />,
    );
    expect(await screen.findByText("Brief für Kind 9")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Kind für die Vorschau" }),
    ).toHaveTextContent("Mia");

    view.rerender(<LetterBodyField {...props} previewChildren={null} />);
    expect(
      await screen.findByText(/Noch kein Kind in der Auswahl/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Brief für Kind 9")).not.toBeInTheDocument();
  });

  it("shows a placeholder load error and retries the failed load", async () => {
    fetchLetterPlaceholders.mockRejectedValueOnce(
      unavailableApiError(new TypeError("Failed to fetch")),
    );
    render(<Harness initial="Liebe Eltern" />);

    const retry = await screen.findByRole("button", { name: /Wiederholen/ });
    expect(screen.getByRole("alert")).toHaveTextContent(/Platzhalter/);
    fireEvent.click(retry);

    expect(
      await screen.findByRole("button", { name: /Vorname des Kindes/ }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(fetchLetterPlaceholders).toHaveBeenCalledTimes(2);
  });
});
