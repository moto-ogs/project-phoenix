import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import type {
  HolidayCriteriaRanking,
  HolidayCriterion,
} from "~/lib/traeger-holiday-allocation-api";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("~/lib/traeger-holiday-allocation-api", async (original) => ({
  ...(await original<typeof import("~/lib/traeger-holiday-allocation-api")>()),
  saveHolidayCriteria: (...args: unknown[]) => save(...args),
}));

import { HolidayCriteriaEditor } from "./holiday-criteria-editor";

const STORED: HolidayCriterion[] = [
  {
    id: "1",
    name: "Beide Eltern berufstätig",
    question: "Sind beide Eltern berufstätig?",
    scope: "family",
    active: true,
    position: 1,
    points: 3,
    answered: true,
  },
];

// The page's read: a save hands its answer to `write` (ADR 0311).
function renderEditor(
  onSaved = vi.fn(),
  ranking: HolidayCriteriaRanking = "priority",
) {
  render(
    <ToastProvider>
      <HolidayCriteriaEditor
        source={{
          opening: "criteria",
          data: { criteria: STORED, ranking, version: "criteria-read" },
          reload: vi.fn(),
          write: onSaved,
        }}
      />
    </ToastProvider>,
  );
  return onSaved;
}

describe("holiday criteria editor (#4700)", () => {
  beforeEach(() => {
    save.mockReset();
  });

  it("adds a template, moves it to the top and saves the list in that order", async () => {
    const saved = {
      criteria: [] as HolidayCriterion[],
      ranking: "priority" as const,
      version: "saved",
    };
    save.mockResolvedValue(saved);
    const onSaved = renderEditor();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Vorlage „Geschwisterkind ist schon angemeldet“ hinzufügen",
      }),
    );
    expect(
      screen.queryByRole("button", {
        name: "Vorlage „Geschwisterkind ist schon angemeldet“ hinzufügen",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "„Geschwisterkind ist schon angemeldet“ nach oben, höhere Priorität",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Kriterien speichern" }),
    );

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // The list goes out with the version it was read in.
    expect(save.mock.calls[0]![1]).toBe("priority");
    expect(save.mock.calls[0]![2]).toBe("criteria-read");
    expect(save.mock.calls[0]![0]).toEqual([
      {
        id: "",
        name: "Geschwisterkind ist schon angemeldet",
        question:
          "Ist ein Geschwisterkind schon für diese Ferienbetreuung angemeldet?",
        scope: "child",
        active: true,
        points: 1,
      },
      {
        id: "1",
        name: "Beide Eltern berufstätig",
        question: "Sind beide Eltern berufstätig?",
        scope: "family",
        active: true,
        points: 3,
      },
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });

  it("shows the parents' view of the question and keeps the scope of an answered criterion", () => {
    renderEditor();
    const preview = screen.getByText(
      "So sehen Eltern die Frage",
    ).parentElement!;
    expect(
      within(preview).getByText("Sind beide Eltern berufstätig?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Eltern haben schon geantwortet. Darum bleibt das so."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jedes Kind" })).toBeDisabled();
  });

  it("marks an empty own criterion at its fields before saving", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Eigenes Kriterium" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Kriterien speichern" }),
    );
    expect(
      await screen.findByText("Bitte gib einen Namen ein."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bitte schreibe die Frage an die Eltern."),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("shows a refused scope at its choice", async () => {
    save.mockRejectedValue(
      new ApiError("invalid", 400, {
        code: "general.input",
        errors: [{ field: "criteria.0.scope", reason: "answered" }],
      }),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "Beide Eltern arbeiten" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Kriterien speichern" }),
    );
    const group = await screen.findByRole("group", {
      name: "Gilt für: Beide Eltern arbeiten",
    });
    await waitFor(() =>
      expect(group).toHaveAttribute("aria-describedby", expect.any(String)),
    );
    const hint = document.getElementById(
      group.getAttribute("aria-describedby")!,
    );
    expect(hint).toBeInTheDocument();
    expect(hint).not.toBeEmptyDOMElement();
  });

  it("reads the stored criteria again after a list saved since", async () => {
    save.mockRejectedValue(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const reload = vi.fn().mockResolvedValue({
      criteria: STORED,
      ranking: "priority",
      version: "colleague",
    });
    render(
      <ToastProvider>
        <HolidayCriteriaEditor
          source={{
            opening: "criteria",
            data: {
              criteria: STORED,
              ranking: "priority",
              version: "criteria-read",
            },
            reload,
          }}
        />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "Beide Eltern arbeiten" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Kriterien speichern" }),
    );
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Kriterien"),
      ),
    ).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("puts a refusal of the backend at its field", async () => {
    save.mockRejectedValue(
      new ApiError("invalid", 400, {
        code: "general.input",
        errors: [{ field: "criteria.0.name", reason: "too_long" }],
      }),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "Beide Eltern arbeiten" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Kriterien speichern" }),
    );
    expect(
      await screen.findByText(/Bitte prüfe deine Angaben\./),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/^Name/)).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
  });

  // #8135: criteria without a ranking.
  it("lets every criterion count the same and saves that with the list", async () => {
    save.mockResolvedValue({
      criteria: STORED,
      ranking: "equal",
      version: "saved",
    });
    renderEditor();
    expect(screen.getByRole("radio", { name: /Nach Rangfolge/ })).toBeChecked();
    expect(screen.getByText("Priorität 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Alle gleich/ }));
    // No rank is shown any more, and the arrows only move the question.
    expect(screen.getByText("Zählt gleich")).toBeInTheDocument();
    expect(screen.queryByText("Priorität 1")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "„Beide Eltern berufstätig“ nach oben",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bei Gleichstand zählt, wer sich zuerst angemeldet hat.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Kriterien speichern" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![1]).toBe("equal");
    // The stored points stay, so a later switch to points keeps them.
    expect(save.mock.calls[0]![0]).toMatchObject([{ id: "1", points: 3 }]);
  });

  it("asks for points only when they count and refuses none", async () => {
    renderEditor();
    expect(screen.queryByLabelText(/^Punkte/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Nach Punkten/ }));
    const points = screen.getByLabelText(/^Punkte/);
    expect(points).toHaveValue("3");
    expect(screen.getByText("3 Punkte")).toBeInTheDocument();
    expect(
      screen.getByText(/Ein Kind kann höchstens 3 Punkte bekommen\./),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "„Beide Eltern berufstätig“: einen Punkt mehr",
      }),
    );
    expect(points).toHaveValue("4");

    fireEvent.change(points, { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Kriterien speichern" }),
    );
    expect(
      await screen.findByText("Bitte gib 1 bis 100 Punkte ein."),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("opens on the stored way of counting", () => {
    renderEditor(vi.fn(), "points");
    expect(screen.getByRole("radio", { name: /Nach Punkten/ })).toBeChecked();
    expect(screen.getByLabelText(/^Punkte/)).toHaveValue("3");
    expect(
      screen.getByRole("button", { name: "Kriterien speichern" }),
    ).toBeDisabled();
  });
});
