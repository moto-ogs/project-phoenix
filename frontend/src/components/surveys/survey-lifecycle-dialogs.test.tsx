import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Survey } from "~/lib/surveys-api";

import {
  CloseSurveyDialog,
  DeleteSurveyDialog,
  PublishSurveyDialog,
  RemindSurveyDialog,
} from "./survey-lifecycle-dialogs";

const { publishMock, closeMock, remindMock, deleteMock } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  closeMock: vi.fn(),
  remindMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("~/lib/surveys-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/surveys-api")>();
  return {
    ...actual,
    publishSurvey: publishMock,
    closeSurvey: closeMock,
    remindSurvey: remindMock,
    deleteSurvey: deleteMock,
  };
});

const draft: Survey = {
  id: "21",
  version: "2026-09-01T08:00:00Z",
  fingerprint: "fp-21",
  title: "Elternzufriedenheit",
  intro: "",
  audience: "parents",
  anonymous: true,
  send_email: true,
  status: "draft",
  closes_at: "2026-09-30T10:00:00Z",
  created_at: "2026-08-30T08:00:00Z",
  updated_at: "2026-09-01T08:00:00Z",
  participant_count: 0,
  targets: [{ target_type: "school_all" }],
  questions: [],
};
const open: Survey = { ...draft, status: "open", participant_count: 3 };

describe("survey lifecycle dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishMock.mockResolvedValue(open);
    closeMock.mockResolvedValue(open);
    remindMock.mockResolvedValue(4);
    deleteMock.mockResolvedValue(undefined);
  });

  it("names audience, anonymity and e-mail and publishes the shown version", async () => {
    const onClose = vi.fn();
    render(
      <PublishSurveyDialog
        survey={draft}
        reload={vi.fn(() => Promise.resolve())}
        onClose={onClose}
        onDone={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Umfrage veröffentlichen" }),
    ).toHaveAccessibleDescription("„Elternzufriedenheit“");
    expect(screen.getByText("Eltern: Ganze Schule")).toBeInTheDocument();
    expect(screen.getByText("Anonym")).toBeInTheDocument();
    expect(screen.getByText("Ja, zusätzlich")).toBeInTheDocument();
    expect(screen.getByText(/nichts mehr ändern/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Jetzt veröffentlichen" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(publishMock).toHaveBeenCalledWith("21", "2026-09-01T08:00:00Z");
  });

  it("offers no e-mail line for a staff survey and says answers carry names", () => {
    render(
      <PublishSurveyDialog
        survey={{ ...draft, audience: "staff", anonymous: false }}
        reload={vi.fn(() => Promise.resolve())}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByText("Mitarbeitende")).toBeInTheDocument();
    expect(screen.getByText("Mit Namen")).toBeInTheDocument();
    expect(screen.queryByText("E-Mail an Eltern")).not.toBeInTheDocument();
  });

  it("hands the number of reminded people to the page", async () => {
    const onReminded = vi.fn();
    render(
      <RemindSurveyDialog
        survey={open}
        onClose={vi.fn()}
        onReminded={onReminded}
      />,
    );

    expect(screen.getByText("3 Teilnahmen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erinnerung senden" }));

    await waitFor(() => expect(onReminded).toHaveBeenCalledWith(4));
    expect(remindMock).toHaveBeenCalledWith("21");
  });

  it("ends the survey after saying that it cannot be undone", async () => {
    const onDone = vi.fn();
    render(
      <CloseSurveyDialog survey={open} onClose={vi.fn()} onDone={onDone} />,
    );

    expect(screen.getByText(/nicht rückgängig machen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jetzt beenden" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(closeMock).toHaveBeenCalledWith("21");
  });

  it("deletes a survey with answers only after LÖSCHEN is typed, with the shown fingerprint", async () => {
    const onDone = vi.fn();
    render(
      <DeleteSurveyDialog
        survey={open}
        reload={vi.fn(() => Promise.resolve())}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Endgültig löschen" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/LÖSCHEN/), {
      target: { value: "LÖSCHEN" },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(deleteMock).toHaveBeenCalledWith("21", "fp-21");
  });
});
