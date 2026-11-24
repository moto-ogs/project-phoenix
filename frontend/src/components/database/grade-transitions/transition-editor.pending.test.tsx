// #6593: Während der Entwurf gespeichert wird, ist das Panel gesperrt; eine
// späte Antwort wechselt keinen geschlossenen Editor zur Vorschau. Echter
// SlideOver über dem gemeinsamen Vaul-Mock.
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import { SWRConfig } from "~/lib/swr/testing";
import type { GradeTransition } from "~/lib/grade-transition-api";
import { catalogText } from "~/test/error-catalog-text";
import {
  deferred,
  expectSlideOverSaveLocked,
  expectSlideOverUnlocked,
} from "~/test/helpers/form-modal-pending";

vi.mock("vaul", () => import("~/test/mocks/vaul"));
vi.unmock("swr");

const session = {
  data: { user: { id: "1", tenantId: "1", scope: "tenant" } },
  status: "authenticated",
};
vi.mock("next-auth/react", () => ({ useSession: () => session }));

function render(ui: ReactElement) {
  return rtlRender(ui, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    ),
  });
}

const { api } = vi.hoisted(() => ({
  api: {
    fetchTransitionClasses: vi.fn(),
    fetchSuggestedMappings: vi.fn(),
    updateGradeTransition: vi.fn(),
    createGradeTransition: vi.fn(),
  },
}));
vi.mock("~/lib/grade-transition-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/grade-transition-api")>()),
  ...api,
}));

import { TransitionEditor } from "./transition-editor";

const TITLE = "Schuljahreswechsel bearbeiten";
const FOOTER = ["Abbrechen", "Speichern …"];

const draft: GradeTransition = {
  id: "8",
  academicYear: "2026-2027",
  status: "draft",
  appliedAt: null,
  revertedAt: null,
  createdAt: "2026-07-24T09:00:00Z",
  notes: null,
  mappings: [{ id: "1", fromClass: "1a", toClass: "2a", action: "promote" }],
  canModify: true,
  canApply: true,
  canRevert: false,
  version: "v1",
};

function renderAndSave(reload?: () => Promise<GradeTransition>) {
  const answer = deferred<GradeTransition>();
  api.updateGradeTransition.mockReturnValue(answer.promise);
  const onClose = vi.fn();
  const onReadyForPreview = vi.fn();
  const view = render(
    <TransitionEditor
      existingDraft={draft}
      onClose={onClose}
      onReadyForPreview={onReadyForPreview}
      reload={reload}
    />,
  );
  fireEvent.change(screen.getByLabelText("Notiz (optional)"), {
    target: { value: "Sommer" },
  });
  const save = screen.getByRole("button", { name: "Weiter zur Vorschau" });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  return { ...view, answer, onClose, onReadyForPreview };
}

describe("TransitionEditor pending lock (#6593)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchTransitionClasses.mockResolvedValue(["1a"]);
  });

  it("shows the cached suggestions at once on reopening and keeps an edit", async () => {
    const first = [
      {
        fromClass: "1a",
        toClass: "2a",
        isGraduating: false,
        ambiguous: false,
        studentCount: 2,
      },
    ];
    api.fetchSuggestedMappings.mockResolvedValue(first);
    const props = {
      existingDraft: null,
      onClose: vi.fn(),
      onReadyForPreview: vi.fn(),
    };
    const view = render(<TransitionEditor {...props} />);
    expect(await screen.findByLabelText("Zielklasse für 1a")).toHaveValue("2a");
    view.rerender(<></>);
    view.rerender(<TransitionEditor {...props} />);
    // Die Vorlage kommt aus dem Cache; der Server prüft sie beim Speichern.
    expect(screen.getByLabelText("Zielklasse für 1a")).toHaveValue("2a");
    expect(
      screen.getByRole("button", { name: "Weiter zur Vorschau" }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Zielklasse für 1a"), {
      target: { value: "2c" },
    });
    expect(screen.getByLabelText("Zielklasse für 1a")).toHaveValue("2c");
  });

  it("locks the panel while saving and unlocks it after a failure", async () => {
    const { answer, onClose, onReadyForPreview } = renderAndSave();

    expectSlideOverSaveLocked(TITLE, FOOTER);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      answer.reject(new ApiError("kaputt", 500, { code: "general.server" }));
    });

    expect(
      await screen.findByText(
        catalogText("general.server", "das Speichern des Entwurfs"),
      ),
    ).toBeInTheDocument();
    expectSlideOverUnlocked(TITLE);
    expect(screen.getByLabelText("Notiz (optional)")).toHaveValue("Sommer");
    expect(onReadyForPreview).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hands the saved draft to the preview", async () => {
    const { answer, onReadyForPreview } = renderAndSave();

    await act(async () => {
      answer.resolve({ ...draft, notes: "Sommer" });
    });

    expect(onReadyForPreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "8", notes: "Sommer" }),
    );
  });

  it("does not switch to the preview when the answer arrives after unmount", async () => {
    const { answer, onReadyForPreview, unmount } = renderAndSave();
    expect(api.updateGradeTransition).toHaveBeenCalledOnce();

    unmount();
    await act(async () => {
      answer.resolve(draft);
    });

    expect(onReadyForPreview).not.toHaveBeenCalled();
  });

  it("shows the stored draft instead of a retry when a colleague saved it since (ADR 0311)", async () => {
    const stored = { ...draft, notes: "Kollegin", version: "v2" };
    const { answer, rerender, onReadyForPreview } = renderAndSave(() =>
      Promise.resolve(stored),
    );
    expect(api.updateGradeTransition).toHaveBeenCalledWith(
      "8",
      expect.objectContaining({ expectedVersion: "v1", notes: "Sommer" }),
    );
    await act(async () =>
      answer.reject(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      ),
    );
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "das Speichern des Entwurfs"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Wiederholen|Erneut versuchen/ }),
    ).not.toBeInTheDocument();
    expect(onReadyForPreview).not.toHaveBeenCalled();

    rerender(
      <TransitionEditor
        existingDraft={stored}
        onClose={vi.fn()}
        onReadyForPreview={onReadyForPreview}
      />,
    );
    expect(screen.getByLabelText("Notiz (optional)")).toHaveValue("Kollegin");
  });

  // ADR 0311 rule 6: a failed read of the stored draft after a refusal is a
  // load error, and the refused version is not sent again.
  it("names a failed read of the stored draft after a refusal", async () => {
    const { answer } = renderAndSave(() =>
      Promise.reject(
        new ApiError("down", 503, { code: "general.unavailable" }),
      ),
    );
    await act(async () =>
      answer.reject(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      ),
    );
    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Du siehst jetzt den neuen Stand/),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Weiter zur Vorschau" }),
    );
    expect(api.updateGradeTransition).toHaveBeenCalledOnce();
  });
});
