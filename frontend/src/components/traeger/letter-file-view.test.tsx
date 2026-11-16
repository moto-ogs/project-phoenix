import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { LetterFileView } from "./letter-file-view";

vi.unmock("swr");
vi.mock("~/components/ui/pdf-preview", () => ({
  useObjectUrl: () => null,
  PdfPreview: () => <span>PDF-Vorschau</span>,
}));

describe("LetterFileView", () => {
  it("performs its audited request again on every opening", async () => {
    const load = vi
      .fn()
      .mockResolvedValue({ blob: new Blob(["PDF"]), filename: "letter.pdf" });
    const view = (open: boolean) =>
      open ? (
        <LetterFileView
          fileKey="invoice-41"
          load={load}
          title="Rechnung MB-1"
        />
      ) : null;
    const { rerender } = render(view(true), {
      wrapper: TraegerResourceTestProvider,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Rechnung MB-1 herunterladen" }),
      ).toBeEnabled(),
    );
    expect(load).toHaveBeenCalledTimes(1);
    rerender(view(false));
    rerender(view(true));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Rechnung MB-1 herunterladen" }),
      ).toBeEnabled(),
    );
  });
});
