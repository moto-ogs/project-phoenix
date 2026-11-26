import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readEnrollmentStatusSeed,
  readHolidayRegistrationStatusSeed,
} from "./token-status-seed.server";

const backend = vi.hoisted(() => vi.fn());
const requestHeaders = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ headers: requestHeaders }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "de",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/lib/backend-client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/backend-client.server")>()),
  sendBackend: backend,
}));

function success(data: unknown) {
  return Response.json({ status: "success", data });
}

const enrollment = {
  request_id: "7",
  guardian_first_name: "Mara",
  guardian_last_name: "Muster",
  guardian_email: "mara@example.test",
  submitted_at: "2026-01-15T10:00:00Z",
  edit_mode: "none",
  children: [],
  signature_required: true,
  care_facility_term: "OGS",
  care_facility_article: "die",
  signature: {
    method: "drawn",
    signer_name: "Mara Muster",
    signed_at: "2026-01-15T10:00:00Z",
    integrity_ok: true,
    document_sha256: "unused-proof-hash",
    image_png: "ignored-image",
  },
};

describe("token status seeds", () => {
  beforeEach(() => {
    backend.mockReset();
    requestHeaders.mockResolvedValue(new Headers());
  });

  it("seeds only what the enrollment status and its changes show", async () => {
    backend.mockImplementation(async (path: string) => {
      if (path.endsWith("/change-requests")) {
        return success([
          {
            id: "8",
            request_id: "7",
            origin: "parent",
            status: "pending_review",
            base_snapshot: {
              guardian_phone: "0123",
              guardian_email: "unchanged@example.test",
            },
            proposed_snapshot: {
              guardian_phone: "0456",
              guardian_email: "unchanged@example.test",
            },
            diff: { changed: ["guardian_phone"] },
            created_at: "2026-01-16T10:00:00Z",
            updated_at: "2026-01-16T10:00:00Z",
            messages: [
              {
                id: "9",
                author_type: "staff",
                body: "private staff note",
                created_at: "2026-01-16T10:00:00Z",
                internal_only: true,
              },
            ],
          },
        ]);
      }
      if (path.endsWith("/form-labels"))
        return success({ fields: [], legal_blocks: [] });
      return success(enrollment);
    });

    const seed = await readEnrollmentStatusSeed("secret-link");
    expect(seed?.data).toMatchObject({
      status: { signature: { signer_name: "Mara Muster", integrity_ok: true } },
      changesLocale: "de",
      changes: [{ groups: [{ rows: [{ before: "0123", after: "0456" }] }] }],
    });
    expect(JSON.stringify(seed)).not.toMatch(
      /unchanged@example.test|private staff note|unused-proof-hash|ignored-image|secret-link|request_id/,
    );
    expect(backend.mock.calls.map(([path, bearer]) => [path, bearer])).toEqual([
      ["/api/enrollment/requests/secret-link", undefined],
      ["/api/enrollment/requests/secret-link/change-requests", undefined],
      ["/api/enrollment/requests/secret-link/form-labels", undefined],
    ]);
  });

  it("does not spend capability reads during speculative rendering", async () => {
    requestHeaders.mockResolvedValue(
      new Headers({ "next-router-prefetch": "1" }),
    );
    await expect(
      readEnrollmentStatusSeed("secret-link"),
    ).resolves.toBeUndefined();
    await expect(
      readHolidayRegistrationStatusSeed("secret-link"),
    ).resolves.toBeUndefined();
    expect(backend).not.toHaveBeenCalled();
  });

  it("preserves success when the enrollment change request list fails", async () => {
    backend.mockResolvedValueOnce(success(enrollment));
    backend.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const seed = await readEnrollmentStatusSeed("secret-link");
    expect(seed?.data.status.guardian_first_name).toBe("Mara");
    expect(seed?.data.changes).toBeUndefined();
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it("reads the holiday status again for each token and leaves a refusal to the browser", async () => {
    backend.mockResolvedValueOnce(
      success({
        traeger_name: "Gemeinde Bissendorf",
        period_name: "Winterferien",
        first_day: null,
        last_day: null,
        registration_closes_on: "2026-11-12",
        binding: true,
        allocation_mode: "criteria",
        submitted_at: "2026-11-01T08:00:00Z",
        status: "received",
        children: [],
      }),
    );
    backend.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const seed = await readHolidayRegistrationStatusSeed("valid-link");
    expect(seed?.data).toMatchObject({
      periodName: "Winterferien",
      children: [],
    });
    expect(seed?.data).not.toHaveProperty("allocationMode");
    await expect(
      readHolidayRegistrationStatusSeed("revoked-link"),
    ).resolves.toBeUndefined();
    expect(backend.mock.calls.map(([path, bearer]) => [path, bearer])).toEqual([
      ["/traeger/holiday-registrations/status/valid-link", undefined],
      ["/traeger/holiday-registrations/status/revoked-link", undefined],
    ]);
  });
});
