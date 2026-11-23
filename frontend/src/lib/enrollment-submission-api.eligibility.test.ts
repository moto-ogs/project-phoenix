import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchParentEnrollmentBootstrap } from "./enrollment-submission-api";

const mockFetch = vi.fn<typeof fetch>();
const originalFetch = global.fetch;

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/** A parent bootstrap as the contract answers it. */
function bootstrap(phaseId: string) {
  return {
    data: {
      phase: {
        id: phaseId,
        name: "2026",
        kind: "school_year",
        service_start_date: "2026-08-01",
        service_end_date: "2027-07-31",
        show_status_reason_to_parent: true,
        care_offering_selection_mode: "optional",
        audience: "linked_parents",
        eligible_grade_levels: null,
      },
      schema: null,
      offerings: null,
      care_offering_selection_mode: "optional",
      care_required: false,
      school_class: {
        collect: false,
        available_classes: null,
        require: false,
        collect_grade_1: false,
      },
      collect_grade_level: true,
      care_offerings_enabled: true,
      captcha_config: { enabled: false, site_key: "" },
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
        blocks: null,
      },
    },
  };
}

// The parent-scoped bootstrap (#1663) exists because the public endpoint
// refuses audience-restricted phases.
describe("enrollment eligibility client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("fetchParentEnrollmentBootstrap", () => {
    it("loads the form from the parent-scoped endpoint", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(bootstrap("7")));

      const result = await fetchParentEnrollmentBootstrap("demo-school", "7");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/parent/enrollments/demo-school/bootstrap/7",
        expect.objectContaining({ method: "GET", cache: "no-store" }),
      );
      expect(result.phase).toMatchObject({
        id: "7",
        audience: "linked_parents",
      });
    });

    it("passes a late-invite token through as a query parameter", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(bootstrap("7")));

      await fetchParentEnrollmentBootstrap("demo-school", "7", {
        lateInviteToken: "tok en/1",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/parent/enrollments/demo-school/bootstrap/7?late_invite=tok+en%2F1",
        expect.objectContaining({ method: "GET", cache: "no-store" }),
      );
    });

    it("encodes slug and phase id", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(bootstrap("a/b")));

      await fetchParentEnrollmentBootstrap("de mo/school", "a/b");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/parent/enrollments/de%20mo%2Fschool/bootstrap/a%2Fb",
        expect.objectContaining({ method: "GET", cache: "no-store" }),
      );
    });

    it("surfaces a failed load as an error", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "Phase nicht verfügbar" }, { status: 404 }),
      );

      await expect(
        fetchParentEnrollmentBootstrap("demo-school", "7"),
      ).rejects.toThrow();
    });
  });
});
