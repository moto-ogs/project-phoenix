import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type { Announcement } from "~/lib/parent-announcements-api";
import { catalogText } from "~/test/error-catalog-text";
import {
  buildAnnouncementMenuItems,
  DeleteAnnouncementDialog,
  PublishAnnouncementDialog,
  UnpublishAnnouncementDialog,
} from "./announcement-lifecycle-dialogs";

const { publishMock, unpublishMock, deleteMock } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  unpublishMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("~/lib/parent-announcements-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/parent-announcements-api")>();
  return {
    ...actual,
    publishAnnouncement: publishMock,
    unpublishAnnouncement: unpublishMock,
    deleteAnnouncement: deleteMock,
  };
});

const announcement: Announcement = {
  id: "7",
  version: "2026-09-01T08:00:00Z",
  title: "Sommerfest",
  body: "Am Freitag.",
  priority: "info",
  requires_acknowledgement: false,
  send_email: true,
  status: "draft",
  active: true,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  targets: [{ target_type: "school_all" }],
  response_type: "none",
  options: [],
  delivery_mode: "standard",
  email_audience: "portal_only",
};

describe("lifecycle dialogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishMock.mockResolvedValue(announcement);
    unpublishMock.mockResolvedValue(announcement);
    deleteMock.mockResolvedValue(undefined);
  });

  it("names recipients and e-mail, publishes the shown draft, refreshes and closes", async () => {
    const onDone = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <PublishAnnouncementDialog
        reload={vi.fn(() => Promise.resolve())}
        announcement={announcement}
        onClose={onClose}
        onDone={onDone}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Elternmitteilung veröffentlichen",
    });
    expect(dialog).toHaveAccessibleDescription("„Sommerfest“");
    expect(screen.getByText("Ganze Schule")).toBeInTheDocument();
    expect(screen.getByText("Wird versendet")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Jetzt veröffentlichen" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The version of the draft the dialog shows (ADR 0311).
    expect(publishMock).toHaveBeenCalledWith(
      "7",
      "2026-09-01T08:00:00Z",
      undefined,
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("says when publishing sends no e-mail", () => {
    render(
      <PublishAnnouncementDialog
        reload={vi.fn(() => Promise.resolve())}
        announcement={{ ...announcement, send_email: false }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByText("Wird nicht versendet")).toBeInTheDocument();
  });

  it("names the e-mail audience of an Elternbrief apart from who sees it", () => {
    render(
      <PublishAnnouncementDialog
        reload={vi.fn(() => Promise.resolve())}
        announcement={{
          ...announcement,
          delivery_mode: "letter",
          email_audience: "all_contacts",
        }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(screen.getByText("An alle Bezugspersonen")).toBeInTheDocument();
  });

  // #2517: the failure stays in the dialog, named after the step.
  it("keeps a failed publish in the open dialog", async () => {
    publishMock.mockRejectedValueOnce(
      new ApiError("publish exploded", 500, { code: "general.server" }),
    );
    const onClose = vi.fn();
    render(
      <PublishAnnouncementDialog
        reload={vi.fn(() => Promise.resolve())}
        announcement={announcement}
        onClose={onClose}
        onDone={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Jetzt veröffentlichen" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      catalogText("general.server", "das Veröffentlichen der Mitteilung"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("unpublishes through the service", async () => {
    const onDone = vi.fn();
    render(
      <UnpublishAnnouncementDialog
        announcement={{ ...announcement, status: "published" }}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zurückziehen" }));

    await waitFor(() => expect(unpublishMock).toHaveBeenCalledWith("7"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("deletes through the service and surfaces errors in the dialog", async () => {
    deleteMock.mockRejectedValueOnce(
      new ApiError("not allowed", 403, { code: "general.permission" }),
    );
    const onDone = vi.fn();
    render(
      <DeleteAnnouncementDialog
        announcement={announcement}
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        catalogText("general.permission", "das Löschen der Mitteilung"),
      ),
    );
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(deleteMock).toHaveBeenCalledWith("7");
  });
});

describe("buildAnnouncementMenuItems", () => {
  const handlers = {
    onPublish: vi.fn(),
    onEdit: vi.fn(),
    onUnpublish: vi.fn(),
    onDelete: vi.fn(),
  };

  it("offers publish, edit and delete for a draft (plus Anzeigen in the list)", () => {
    expect(
      buildAnnouncementMenuItems(announcement, {
        ...handlers,
        onView: vi.fn(),
      }).map((item) => item.label),
    ).toEqual(["Veröffentlichen", "Anzeigen", "Bearbeiten", "Löschen"]);
    expect(
      buildAnnouncementMenuItems(announcement, handlers).map(
        (item) => item.label,
      ),
    ).toEqual(["Veröffentlichen", "Bearbeiten", "Löschen"]);
  });

  it("offers unpublish and delete for a published announcement", () => {
    expect(
      buildAnnouncementMenuItems(
        { ...announcement, status: "published" },
        handlers,
      ).map((item) => item.label),
    ).toEqual(["Zurückziehen", "Löschen"]);
  });

  it("keeps system rows read-only", () => {
    expect(
      buildAnnouncementMenuItems(
        {
          ...announcement,
          status: "published",
          system_kind: "care_cancellation",
        },
        handlers,
      ),
    ).toEqual([]);
  });
});

describe("buildAnnouncementMenuItems: scheduled reminder (#3162)", () => {
  const handlers = {
    onPublish: vi.fn(),
    onEdit: vi.fn(),
    onUnpublish: vi.fn(),
    onDelete: vi.fn(),
    onReminder: vi.fn(),
  };

  it("offers to plan a reminder on a published Mitteilung", () => {
    expect(
      buildAnnouncementMenuItems(
        { ...announcement, status: "published" },
        handlers,
      ).map((item) => item.label),
    ).toEqual(["Erinnerung planen", "Zurückziehen", "Löschen"]);
  });

  it("offers to change an unsent reminder and hides it once sent", () => {
    expect(
      buildAnnouncementMenuItems(
        {
          ...announcement,
          status: "published",
          reminder_at: "2026-09-24T06:00:00Z",
        },
        handlers,
      ).map((item) => item.label),
    ).toEqual(["Erinnerung ändern", "Zurückziehen", "Löschen"]);
    expect(
      buildAnnouncementMenuItems(
        {
          ...announcement,
          status: "published",
          reminder_at: "2026-09-08T06:00:00Z",
          reminder_sent_at: "2026-09-08T06:02:00Z",
        },
        handlers,
      ).map((item) => item.label),
    ).toEqual(["Zurückziehen", "Löschen"]);
  });

  it("never offers it for drafts, polls or system rows", () => {
    expect(
      buildAnnouncementMenuItems(announcement, handlers).map(
        (item) => item.label,
      ),
    ).toEqual(["Veröffentlichen", "Bearbeiten", "Löschen"]);
    expect(
      buildAnnouncementMenuItems(
        {
          ...announcement,
          status: "published",
          response_type: "single_choice",
        },
        handlers,
      ).map((item) => item.label),
    ).toEqual(["Zurückziehen", "Löschen"]);
    expect(
      buildAnnouncementMenuItems(
        {
          ...announcement,
          status: "published",
          system_kind: "care_cancellation",
        },
        handlers,
      ),
    ).toEqual([]);
  });
});

describe("withdrawing an Einverständnis (#6290)", () => {
  it("says that guardians who answered keep it and can still revoke", () => {
    render(
      <UnpublishAnnouncementDialog
        announcement={{
          ...announcement,
          status: "published",
          delivery_mode: "declaration",
        }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Eltern können nicht mehr neu antworten\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Wer schon geantwortet hat, sieht das Einverständnis weiter und kann eine Zustimmung widerrufen\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/wird für die Eltern nicht mehr sichtbar/),
    ).not.toBeInTheDocument();
  });

  it("keeps the plain wording for a Mitteilung", () => {
    render(
      <UnpublishAnnouncementDialog
        announcement={{ ...announcement, status: "published" }}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/wird für die Eltern nicht mehr sichtbar/),
    ).toBeInTheDocument();
  });
});

// #4800: Klassenbriefe einer Lehrkraft. Die OGS liest sie nur, die Lehrkraft
// führt sie über die Routen von moto schule.
describe("class letters of a Lehrkraft (#4800)", () => {
  const classLetter: Announcement = {
    ...announcement,
    status: "published",
    sender_name: "Lena Lehrerin",
    sender_school_class: "3b",
  };
  const handlers = {
    onPublish: vi.fn(),
    onEdit: vi.fn(),
    onUnpublish: vi.fn(),
    onDelete: vi.fn(),
  };

  it("keeps a class letter read-only for the OGS", () => {
    expect(
      buildAnnouncementMenuItems(classLetter, {
        ...handlers,
        onView: vi.fn(),
      }).map((item) => item.label),
    ).toEqual(["Anzeigen"]);
    expect(buildAnnouncementMenuItems(classLetter, handlers)).toEqual([]);
  });

  it("lets the author withdraw and delete her letter, without an edit form", () => {
    expect(
      buildAnnouncementMenuItems(classLetter, {
        classLetterAuthor: true,
        onPublish: vi.fn(),
        onUnpublish: vi.fn(),
        onDelete: vi.fn(),
      }).map((item) => item.label),
    ).toEqual(["Zurückziehen", "Löschen"]);
    expect(
      buildAnnouncementMenuItems(
        { ...classLetter, status: "draft" },
        {
          classLetterAuthor: true,
          onPublish: vi.fn(),
          onUnpublish: vi.fn(),
          onDelete: vi.fn(),
        },
      ).map((item) => item.label),
    ).toEqual(["Senden", "Löschen"]);
  });

  it("calls the routes of moto schule when given their base", async () => {
    const onClose = vi.fn();
    render(
      <PublishAnnouncementDialog
        reload={vi.fn(() => Promise.resolve())}
        announcement={{ ...classLetter, status: "draft" }}
        apiBase="school"
        onClose={onClose}
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Jetzt veröffentlichen" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(publishMock).toHaveBeenCalledWith(
      "7",
      "2026-09-01T08:00:00Z",
      "school",
    );
  });
});
