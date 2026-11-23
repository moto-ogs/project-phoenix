import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import {
  deleteAnnouncement,
  downloadDeclarationExport,
  fetchDeclarationStatus,
  isDeclaration,
  type Announcement,
} from "./parent-announcements-api";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

const downloadBlobMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/file-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/file-download")>()),
  downloadBlob: downloadBlobMock,
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

function mockFetch(response: Response) {
  const fn = vi.fn(() => Promise.resolve(response));
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

describe("Einverständnisse in the staff client (#3430)", () => {
  it("recognizes an Einverständnis by its delivery mode", () => {
    expect(
      isDeclaration({ delivery_mode: "declaration" } as Announcement),
    ).toBe(true);
    expect(isDeclaration({ delivery_mode: "letter" } as Announcement)).toBe(
      false,
    );
  });

  it("loads the status from the proxy route", async () => {
    const fetchMock = mockFetch(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            kind: "consent",
            signers: "any",
            requires_password: false,
            requires_signature: false,
            deadline: null,
            current_version: null,
            versions: null,
            summary: { agreed: 2 },
            children: null,
            submissions: null,
            integrity_ok: true,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Go writes empty lists as null; a count it leaves out is zero.
    await expect(fetchDeclarationStatus("42")).resolves.toEqual({
      kind: "consent",
      signers: "any",
      requires_password: false,
      requires_signature: false,
      deadline: null,
      current_version: null,
      versions: [],
      summary: {
        children_total: 0,
        agreed: 2,
        declined: 0,
        revoked: 0,
        partial: 0,
        open: 0,
        no_signer: 0,
        expired: 0,
      },
      children: [],
      submissions: [],
      integrity_ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/parent-announcements/42/declaration-status",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("carries the backend code on a refused delete", async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          status: "error",
          detail: "declaration has submissions",
          code: "communication.declaration_has_submissions",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    const error = await deleteAnnouncement("42").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "communication.declaration_has_submissions",
      message: "Elternmitteilung konnte nicht gelöscht werden",
      detail: "declaration has submissions",
    });
  });

  it("downloads an export under the backend's file name", async () => {
    const fetchMock = mockFetch(
      new Response("a;b", {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="erklaerung.csv"',
        },
      }),
    );

    await downloadDeclarationExport("42", "csv");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/parent-announcements/42/declaration-export?format=csv",
      expect.objectContaining({ method: "GET" }),
    );
    expect(downloadBlobMock).toHaveBeenCalledWith(
      expect.any(Blob),
      "erklaerung.csv",
    );
  });

  it("downloads the report as the backend's PDF", async () => {
    const fetchMock = mockFetch(
      new Response("%PDF-1.7", {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            'attachment; filename="nachweis-erklaerung.pdf"',
        },
      }),
    );

    await downloadDeclarationExport("42", "pdf");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/parent-announcements/42/declaration-export?format=pdf",
      expect.objectContaining({ method: "GET" }),
    );
    expect(downloadBlobMock).toHaveBeenCalledWith(
      expect.any(Blob),
      "nachweis-erklaerung.pdf",
    );
  });

  it("throws instead of saving an error body as a file", async () => {
    mockFetch(
      new Response(JSON.stringify({ detail: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(downloadDeclarationExport("42", "csv")).rejects.toThrow(
      "Die Datei konnte nicht erstellt werden",
    );
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });
});
