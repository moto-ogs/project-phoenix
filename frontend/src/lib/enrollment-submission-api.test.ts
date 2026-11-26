import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import {
  confirmRenewal,
  createEnrollmentChangeRequest,
  fetchEnrollmentEditBootstrap,
  fetchPublicEnrollmentBootstrap,
  fetchPublicPhases,
  fetchStatus,
  listEnrollmentChangeRequests,
  patchStatus,
  replyEnrollmentChangeRequest,
  submitEnrollment,
  updateEnrollmentRequest,
  withdrawStatus,
} from "./enrollment-submission-api";
import type * as sharedContract from "~/lib/contract/shared.generated";

const mockFetch = vi.fn<typeof fetch>();
const originalFetch = global.fetch;

/** A public phase as the contract answers it. */
function wirePhase(overrides: Record<string, unknown> = {}) {
  return {
    id: "5",
    name: "2026",
    kind: "school_year",
    service_start_date: "2026-08-01",
    service_end_date: "2027-07-31",
    show_status_reason_to_parent: true,
    care_offering_selection_mode: "optional",
    audience: "open",
    eligible_grade_levels: [],
    ...overrides,
  };
}

/** The parts of a form bootstrap the contract always sends. */
const WIRE_FORM = {
  school_class: {
    collect: false,
    available_classes: [],
    require: false,
    collect_grade_1: false,
  },
  collect_grade_level: true,
  care_offerings_enabled: true,
  legal_texts: {
    agb: "",
    agb_document_url: "",
    agb_display_mode: "",
    dsgvo: "",
    email_contact: "",
    photo: "",
    terms_enabled: false,
    dsgvo_enabled: false,
    email_contact_enabled: false,
    photo_enabled: false,
    blocks: [],
  },
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("enrollment-submission-api", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("keeps the submission error code for the catalog, never the backend text", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { code: "enrollment.care_offering_full", error: "raw backend text" },
        { status: 409 },
      ),
    );

    const error = await submitEnrollment(
      "tenant",
      {} as sharedContract.SubmitEnrollmentRequest,
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "enrollment.care_offering_full",
    });
    expect((error as ApiError).message).not.toContain("raw backend text");
  });

  it("reports a broken connection as unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(fetchStatus("tok")).rejects.toMatchObject({
      code: "general.unavailable",
    });
  });

  it("loads public phases", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [wirePhase({ care_offering_selection_mode: "at_least_one" })],
      }),
    );
    await expect(fetchPublicPhases("demo")).resolves.toHaveLength(1);
  });

  it("loads public enrollment bootstrap from the combined endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          ...WIRE_FORM,
          phase: wirePhase({
            name: "Ferien",
            kind: "holiday",
            care_offering_selection_mode: "exactly_one",
          }),
          schema: {
            id: "12",
            version: 1,
            fields: [],
            core_requirements: null,
          },
          offerings: [
            {
              id: "77",
              phase_id: "5",
              name: "Sommer",
              days_of_week_mode: "fixed",
              available_days: ["mon"],
              includes_holiday_care: true,
              includes_lunch: false,
              is_active: true,
              is_required: false,
              counts_as_care: true,
              auto_add_grade_levels: null,
              auto_add_trigger_offering_ids: null,
              sort_order: 0,
              selection_rule: "optional",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
          care_offering_selection_mode: "exactly_one",
          care_required: true,
          captcha_config: { enabled: true, site_key: "site" },
        },
      }),
    );

    await expect(
      fetchPublicEnrollmentBootstrap("demo slug", "ph/5"),
    ).resolves.toMatchObject({
      phase: { id: "5", name: "Ferien" },
      schema: { id: "12" },
      offerings: [{ id: "77" }],
      care_offering_selection_mode: "exactly_one",
      captcha_config: { site_key: "site" },
      legal_texts: { blocks: [] },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/enrollment/form-bootstrap/public/demo%20slug/ph%2F5",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("submits enrollment payloads and unwraps the response", async () => {
    const payload: sharedContract.SubmitEnrollmentRequest = {
      phase_id: "5",
      guardian_first_name: "Mara",
      guardian_last_name: "Muster",
      guardian_email: "mara@example.test",
      children: [
        {
          first_name: "Lina",
          last_name: "Muster",
          date_of_birth: "2018-04-15",
          target_grade_level: 2,
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: { request_id: "99", status_url: "/status/abc" } }),
    );

    await expect(submitEnrollment("tenant", payload)).resolves.toEqual({
      request_id: "99",
      status_url: "/status/abc",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/enrollment/tenant/submit",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  });

  it("throws the submission fallback when the backend sends an unreadable error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("no json", { status: 500 }));

    await expect(
      submitEnrollment("tenant", {
        phase_id: "5",
        guardian_first_name: "Mara",
        guardian_last_name: "Muster",
        guardian_email: "mara@example.test",
        children: [],
      }),
    ).rejects.toThrow("Anmeldung konnte nicht übermittelt werden");
  });

  it("loads status, patches it, and withdraws whole requests or child rows", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          request_id: "99",
          guardian_first_name: "Mara",
          guardian_last_name: "Muster",
          guardian_email: "mara@example.test",
          submitted_at: "2026-01-01T00:00:00Z",
          edit_mode: "direct_edit",
          signature_required: false,
          care_facility_term: "OGS",
          care_facility_article: "die",
          children: [
            {
              id: "7",
              first_name: "Lina",
              last_name: "Muster",
              status: "submitted",
              locked: false,
            },
          ],
        },
      }),
    );
    await expect(fetchStatus("tok/en")).resolves.toMatchObject({
      request_id: "99",
      children: [{ id: "7" }],
    });

    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { message: "ok" } }));
    await expect(
      patchStatus("tok", { guardian_phone: "+49" }),
    ).resolves.toBeUndefined();

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(withdrawStatus("tok")).resolves.toBeUndefined();

    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(withdrawStatus("tok", "7")).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/enrollment/requests/tok/withdraw",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ child_id: "7" }),
      }),
    );
  });

  it("returns null for missing status tokens", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "missing" }, { status: 404 }),
    );

    await expect(fetchStatus("missing")).resolves.toBeNull();
  });

  it("loads and updates enrollment edit drafts", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          ...WIRE_FORM,
          phase: wirePhase(),
          schema: null,
          offerings: [],
          care_offering_selection_mode: "optional",
          care_required: false,
          grade_level_max: 13,
          care_facility_term: "OGS",
          care_facility_article: "die",
          edit_mode: "direct_edit",
          draft: {
            request_id: "99",
            status_token: "tok/en",
            tenant_id: "1",
            tenant_subdomain: "demo",
            phase_id: "5",
            guardian_first_name: "Mara",
            guardian_last_name: "Muster",
            guardian_email: "mara@example.test",
            consent_flags: {},
            custom_data: {},
            children: [],
          },
        },
      }),
    );

    await expect(fetchEnrollmentEditBootstrap("tok/en")).resolves.toMatchObject(
      {
        draft: { request_id: "99", status_token: "tok/en" },
        phase: { id: "5" },
        grade_level_max: 13,
      },
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/enrollment/requests/tok%2Fen/edit-bootstrap",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );

    const payload: sharedContract.SubmitEnrollmentRequest = {
      phase_id: "5",
      guardian_first_name: "Mara",
      guardian_last_name: "Muster",
      guardian_email: "mara@example.test",
      children: [
        {
          first_name: "Lina",
          last_name: "Muster",
          date_of_birth: "2018-04-15",
          target_grade_level: 2,
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ data: { request_id: "99", status_url: "/status/tok" } }),
    );

    await expect(updateEnrollmentRequest("tok/en", payload)).resolves.toEqual({
      request_id: "99",
      status_url: "/status/tok",
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/enrollment/requests/tok%2Fen",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  });

  it("creates, lists, and replies to enrollment change requests", async () => {
    const payload: sharedContract.SubmitEnrollmentRequest = {
      phase_id: "5",
      guardian_first_name: "Mara",
      guardian_last_name: "Muster",
      guardian_email: "mara@example.test",
      children: [
        {
          first_name: "Lina",
          last_name: "Muster",
          date_of_birth: "2018-04-15",
          target_grade_level: 2,
        },
      ],
    };
    const changeRequest = {
      id: "cr-1",
      request_id: "99",
      origin: "parent",
      status: "pending_review",
      parent_note: "Bitte prüfen",
      base_snapshot: {},
      proposed_snapshot: {},
      diff: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    mockFetch.mockResolvedValueOnce(jsonResponse({ data: changeRequest }));
    await expect(
      createEnrollmentChangeRequest("tok/en", payload, "Bitte prüfen"),
    ).resolves.toMatchObject({ id: "cr-1", parent_note: "Bitte prüfen" });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/enrollment/requests/tok%2Fen/change-requests",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, parent_note: "Bitte prüfen" }),
      }),
    );

    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [changeRequest] }));
    await expect(listEnrollmentChangeRequests("tok/en")).resolves.toEqual([
      changeRequest,
    ]);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/enrollment/requests/tok%2Fen/change-requests",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );

    mockFetch.mockResolvedValueOnce(jsonResponse({ data: changeRequest }));
    await expect(
      replyEnrollmentChangeRequest("tok/en", "cr/1", "Danke"),
    ).resolves.toMatchObject({ id: "cr-1" });
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/enrollment/requests/tok%2Fen/change-requests/cr%2F1/messages",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Danke" }),
      }),
    );
  });

  it("surfaces change-request errors with the endpoint fallback", async () => {
    mockFetch.mockResolvedValueOnce(new Response("no json", { status: 500 }));
    await expect(
      createEnrollmentChangeRequest(
        "tok",
        {
          phase_id: "5",
          guardian_first_name: "Mara",
          guardian_last_name: "Muster",
          guardian_email: "mara@example.test",
          children: [],
        },
        "",
      ),
    ).rejects.toThrow("Änderungsanfrage konnte nicht gespeichert werden");

    mockFetch.mockResolvedValueOnce(new Response("no json", { status: 500 }));
    await expect(listEnrollmentChangeRequests("tok")).rejects.toThrow(
      "Änderungsanfragen konnten nicht geladen werden",
    );

    mockFetch.mockResolvedValueOnce(new Response("no json", { status: 500 }));
    await expect(
      replyEnrollmentChangeRequest("tok", "cr-1", "Danke"),
    ).rejects.toThrow("Antwort konnte nicht gesendet werden");
  });

  it("confirms renewals and returns the number of promoted children", async () => {
    const accepted = {
      consentFlags: { terms: true },
      formSchemaId: "81",
      termsFingerprint: "shown-terms",
    };
    // The proxy's envelope: the count is its data.
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "success",
        data: { confirmed: 3 },
      }),
    );
    await expect(confirmRenewal("tok", accepted)).resolves.toBe(3);
    // The ticks travel with the form version the page showed (#6456).
    const [, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      consent_flags: { terms: true },
      form_schema_id: "81",
      terms_fingerprint: "shown-terms",
    });
  });

  it("surfaces fallback messages when status mutations fail", async () => {
    mockFetch.mockResolvedValueOnce(new Response("no json", { status: 500 }));
    await expect(fetchStatus("tok")).rejects.toThrow(
      "Status konnte nicht geladen werden",
    );

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: "Bearbeitung gesperrt" }, { status: 423 }),
    );
    await expect(fetchEnrollmentEditBootstrap("tok")).rejects.toThrow(
      "Anmeldung kann nicht bearbeitet werden",
    );

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "Speichern gesperrt" }, { status: 423 }),
    );
    await expect(
      updateEnrollmentRequest("tok", {
        phase_id: "5",
        guardian_first_name: "Mara",
        guardian_last_name: "Muster",
        guardian_email: "mara@example.test",
        children: [],
      }),
    ).rejects.toThrow("Änderungen konnten nicht gespeichert werden");

    mockFetch.mockResolvedValueOnce(new Response("no json", { status: 500 }));
    await expect(
      patchStatus("tok", { guardian_first_name: "Mara" }),
    ).rejects.toThrow("Änderungen konnten nicht gespeichert werden");

    // The backend sentence is diagnosis only (ADR 0006): the error keeps
    // the client's fallback and the status class for the catalog.
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: "Schon zurückgenommen" }, { status: 409 }),
    );
    await expect(withdrawStatus("tok")).rejects.toMatchObject({
      message: "Rücknahme nicht möglich",
      code: "general.business_rejection",
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "Abgelaufen" }, { status: 410 }),
    );
    await expect(
      confirmRenewal("tok", {
        consentFlags: {},
        formSchemaId: "0",
        termsFingerprint: "empty-terms",
      }),
    ).rejects.toMatchObject({
      message: "Bestätigung nicht möglich",
      code: "general.business_rejection",
    });
  });
});
