import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { ApiError } from "./api-error";
import { studentNotesService } from "./student-notes-api";

describe("studentNotesService errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies a failed load by its status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );

    const error = await studentNotesService.list("42").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: "general.server" });
  });

  it("does not expose a backend validation error when saving a note", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          error: "invalid student note",
          code: "general.input",
          errors: [{ field: "body", reason: "too long" }],
        },
        { status: 400 },
      ),
    );

    const error = await studentNotesService
      .create("42", {
        kind: "journal",
        visibility: "all_staff",
        body: "Kurzes Gespräch.",
        subjectDate: "2026-09-09",
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "general.input",
      errors: [{ field: "body", reason: "too long" }],
    });
    // The backend sentence is diagnosis; the screen reads the code.
    expect((error as Error).message).not.toContain("invalid student note");
  });
});

describe("studentNotesService activities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the child's activities for the note reference", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: {
          activities: [
            { id: "12", name: "Fußball-AG" },
            { id: "15", name: "Schach" },
          ],
        },
      }),
    );

    await expect(studentNotesService.listActivities("42")).resolves.toEqual([
      { id: "12", name: "Fußball-AG" },
      { id: "15", name: "Schach" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/students/42/note-subjects",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("classifies a failed activities read by its status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );

    await expect(
      studentNotesService.listActivities("42"),
    ).rejects.toMatchObject({ status: 500, code: "general.server" });
  });

  it("sends the chosen activity as the note's reference", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: {} }));

    await studentNotesService.create("42", {
      kind: "journal",
      visibility: "group_leads",
      body: "Hat beim Training gefehlt.",
      subjectDate: "2026-09-09",
      activityGroupId: "12",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      activity_group_id: "12",
      education_group_id: null,
      subject_date: "2026-09-09",
    });
  });
});

describe("studentNotesService team notice revisions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the observed note IDs and exact announcement timestamps", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [] }));
    const informedAt = "2026-09-09T10:00:00.123456Z";
    await expect(
      studentNotesService.markTeamNoticesRead("42", [
        { noteId: "9007199254740993", informedAt },
      ]),
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/students/42/team-notices/read",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          notices: [{ note_id: "9007199254740993", informed_at: informedAt }],
        }),
      }),
    );
  });
});
