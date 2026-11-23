import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    Response.json({ data: { id: "7", student_id: "42" } }, { status: 200 }),
  );
});

import {
  studentAccidentReportsService,
  type AccidentReportFields,
} from "./student-accident-reports-api";

const fields: AccidentReportFields = {
  occurredAt: "2026-08-24T07:40:00Z",
  location: "Schulhof",
  description: "Beim Klettern abgerutscht.",
  injuredBodyParts: "Linker Unterarm",
  injuryKind: "Prellung",
  witnesses: "",
  firstAid: "Gekühlt",
  doctorVisited: false,
  doctor: "",
  parentsNotified: "",
  parentsNotifiedAt: null,
  supervisor: "Frau Berger",
};

function sentBody(): unknown {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return init?.body;
}

// ADR 0311: every write on a report sends the version the person read, so the
// backend refuses it after a colleague changed the report.
describe("studentAccidentReportsService sends the version that was read", () => {
  it("with a change", async () => {
    await studentAccidentReportsService.update("42", "7", fields, "read-v1");
    expect(JSON.parse(sentBody() as string)).toMatchObject({
      location: "Schulhof",
      expected_version: "read-v1",
    });
  });

  it("with a signature", async () => {
    await studentAccidentReportsService.sign(
      "42",
      "7",
      { method: "drawn", imagePngBase64: "iVBOR" },
      "read-v2",
    );
    expect(JSON.parse(sentBody() as string)).toMatchObject({
      method: "drawn",
      expected_version: "read-v2",
    });
  });

  it("with the paper copy", async () => {
    await studentAccidentReportsService.uploadPaperCopy(
      "42",
      "7",
      new File(["%PDF-1.4"], "Unfallanzeige.pdf", { type: "application/pdf" }),
      "read-v3",
    );
    const form = sentBody() as FormData;
    expect(form.get("expected_version")).toBe("read-v3");
    expect(form.get("file")).toBeInstanceOf(File);
  });
});
