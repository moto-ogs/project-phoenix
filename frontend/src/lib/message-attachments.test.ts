import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachmentIdArgs,
  checkAttachmentFiles,
  guardianMessageAttachments,
  MAX_MESSAGE_ATTACHMENT_MB,
} from "./message-attachments";

function file(name: string, bytes = 10): File {
  const blob = new File(["x"], name);
  Object.defineProperty(blob, "size", { value: bytes });
  return blob;
}

describe("checkAttachmentFiles", () => {
  it("nimmt Fotos und Dokumente an", () => {
    const { accepted, refusals } = checkAttachmentFiles(0, [
      file("foto.JPG"),
      file("liste.pdf"),
      file("plan.xlsx"),
    ]);
    expect(accepted.map((f) => f.name)).toEqual([
      "foto.JPG",
      "liste.pdf",
      "plan.xlsx",
    ]);
    expect(refusals).toEqual([]);
  });

  it("nennt die Datei, die zu groß ist oder nicht erlaubt", () => {
    const { accepted, refusals } = checkAttachmentFiles(0, [
      file("video.mp4"),
      file("riesig.png", MAX_MESSAGE_ATTACHMENT_MB * 1024 * 1024 + 1),
      file("gut.png"),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["gut.png"]);
    expect(refusals).toEqual([
      { kind: "type", filename: "video.mp4" },
      { kind: "too_large", filename: "riesig.png" },
    ]);
  });

  it("hält die Höchstzahl je Nachricht und meldet sie einmal", () => {
    const { accepted, refusals } = checkAttachmentFiles(3, [
      file("a.png"),
      file("b.png"),
      file("c.png"),
      file("d.png"),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["a.png", "b.png"]);
    expect(refusals).toEqual([{ kind: "too_many" }]);
  });
});

describe("Routen und Sende-Argument", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hängt die Anhänge der Eltern an das Kind", async () => {
    const uploaded = {
      id: "7",
      filename: "a.png",
      size_bytes: 1,
      content_type: "image/png",
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: uploaded }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response("%PDF-1.7", { status: 200 }));
    const routes = guardianMessageAttachments("42");

    await expect(routes.upload(file("a.png"))).resolves.toEqual(uploaded);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/parent/me/messages/children/42/attachments",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(routes.downloadUrl("7")).toBe(
      "/api/parent/me/messages/children/42/attachments/7/download",
    );
    await routes.loadFile("7");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/parent/me/messages/children/42/attachments/7/download?inline=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("lässt das Argument ohne Anhänge weg", () => {
    expect(attachmentIdArgs([])).toEqual([]);
    expect(
      attachmentIdArgs([
        {
          id: "9",
          filename: "a.png",
          size_bytes: 1,
          content_type: "image/png",
        },
      ]),
    ).toEqual([["9"]]);
  });
});
