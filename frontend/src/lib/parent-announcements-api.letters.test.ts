import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import {
  SCHOOL_PARENT_LETTERS_BASE,
  downloadLetterPrint,
  previewLetter,
} from "./parent-announcements-api";

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

describe("Serienbriefe in the staff client (#4813)", () => {
  it("downloads every letter of a dispatch under the backend's file name", async () => {
    const fetchMock = mockFetch(
      new Response("%PDF-1.7", {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="elternbriefe-42.pdf"',
        },
      }),
    );

    await downloadLetterPrint("42", SCHOOL_PARENT_LETTERS_BASE);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/school/parent-letters/42/letters-pdf",
      undefined,
    );
    expect(downloadBlobMock).toHaveBeenCalledWith(
      expect.any(Blob),
      "elternbriefe-42.pdf",
    );
  });

  it("keeps a refused print on the page as an error with its code", async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          status: 409,
          detail: "only a published parent letter can be printed",
          code: "communication.letter_print_not_letter",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );

    const error = await downloadLetterPrint("42").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(
      "communication.letter_print_not_letter",
    );
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });

  it("asks the backend to fill the text for one child", async () => {
    const fetchMock = mockFetch(
      new Response(
        JSON.stringify({
          data: {
            body: "Hallo Lina",
            child: {
              student_id: "7",
              first_name: "Lina",
              last_name: "Muster",
              school_class: "1a",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const preview = await previewLetter("Hallo {{vorname}}", "7");

    expect(preview.body).toBe("Hallo Lina");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/parent-announcements/letter-preview");
    expect(JSON.parse(init.body as string)).toEqual({
      body: "Hallo {{vorname}}",
      student_id: "7",
    });
  });
});
