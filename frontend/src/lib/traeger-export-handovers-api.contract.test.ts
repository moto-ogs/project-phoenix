import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExportRecipients } from "./traeger-export-handovers-api";

const request = vi.hoisted(() => vi.fn());
vi.mock("~/lib/bff-fetch", () => ({ bffJson: request }));
afterEach(() => request.mockReset());

// ADR 0270 point 6 (#2353): a format or state a newer backend adds is not
// passed on as a known one.
describe("export recipients as the contract decodes them", () => {
  it("leaves unknown formats out and reads unknown states as unknown", async () => {
    request.mockResolvedValue({
      recipients: [],
      assignments: [
        { format: "datev", recipient_id: "4" },
        { format: "xrechnung", recipient_id: "4" },
      ],
      handovers: [
        {
          id: "9",
          created_at: "2026-11-01T10:00:00+01:00",
          format: "xrechnung",
          filename: "rechnung.xml",
          byte_size: 10,
          target_host: "sftp.example.org",
          target_directory: "/in",
          recipient_id: "4",
          recipient_name: "Kämmerei",
          state: "queued_later",
        },
      ],
    });
    const page = await fetchExportRecipients();
    expect(page.assignments).toEqual([{ format: "datev", recipientId: "4" }]);
    expect(page.handovers[0]).toMatchObject({
      format: undefined,
      state: "unknown",
    });
  });
});
