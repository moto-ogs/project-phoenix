// grade-transition-api.requests.test.ts
// Request-layer tests for the Jahrgangsstufenwechsel admin API client (#405).
// The mapper tests live in grade-transition-api.test.ts; this file covers the
// fetch plumbing: request shape (method, URL, body), the { data } unwrapping,
// and the error paths that must preserve the backend's stable error code.

import type * as adminContract from "~/lib/contract/admin.generated";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

import { pagedJson, plainResponse } from "~/test/mocks/plain-session-fetch";
import { ApiError } from "./api-error";
import {
  createGradeTransition,
  updateGradeTransition,
  deleteGradeTransition,
  previewGradeTransition,
  applyGradeTransition,
  revertGradeTransition,
  fetchTransitionClasses,
  fetchSuggestedMappings,
  fetchTransitionHistory,
  purgeGraduatedStudent,
  listGradeTransitions,
  NOT_APPLIED_CODE,
  NOT_LATEST_TRANSITION_CODE,
  PREVIEW_STALE_CODE,
  NOT_DRAFT_CODE,
} from "./grade-transition-api";

const BASE = "/api/admin/grade-transitions";
// Read-state tokens as the backend mints them (readstate.Fingerprint, ADR
// 0311): opaque hex digests the client carries back unchanged.
const FINGERPRINT = "3f2a9c41d07e8b6a5c19e4f0b27d6a83";
const OLDER_FINGERPRINT = "a81b44e09c3d27f6b5e01c9d8f2a7b64";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let calls: FetchCall[] = [];

/** Stubs global fetch with a single canned response for every call. */
function stubOnce(response: Partial<Response> & { json?: () => unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return plainResponse(response);
    }),
  );
}

/** An ok response whose body is the given value wrapped in { data }. */
const okData = (data: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ data }),
});

/** An ok page of the paginated list route. */
const okPage = (rows: unknown[] | null) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ ...pagedJson(rows ?? []), data: rows }),
});

/** An ok response whose body IS the payload (no { data } envelope). */
const okBare = (body: unknown) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
});

/** A failing response carrying the backend's { error, code } shape. */
const fail = (status: number, body: unknown) => ({
  ok: false,
  status,
  json: () => Promise.resolve(body),
});

/** A failing response whose body is not JSON at all (proxy/gateway HTML). */
const failUnparseable = (status: number) => ({
  ok: false,
  status,
  json: () => Promise.reject(new SyntaxError("Unexpected token <")),
});

const parseBody = (init?: RequestInit) =>
  JSON.parse(String(init?.body ?? "null")) as Record<string, unknown>;

const transitionRow: adminContract.TransitionResponse = {
  id: "7",
  academic_year: "2026-2027",
  status: "draft",
  created_at: "2026-07-24T09:00:00Z",
  created_by: "42",
  can_modify: true,
  can_apply: true,
  can_revert: false,
  version: "v1",
};

const resultRow: adminContract.TransitionResultResponse = {
  warnings: null,
  transition_id: "7",
  status: "applied",
  students_promoted: 40,
  students_graduated: 10,
  can_revert: true,
};

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGradeTransition", () => {
  it("POSTs the camelCase input as snake_case and maps the answer", async () => {
    stubOnce(okData(transitionRow));

    const created = await createGradeTransition({
      academicYear: "2026-2027",
      notes: "Sommer-Wechsel",
      mappings: [
        { fromClass: "1a", toClass: "2a" },
        { fromClass: "4a", toClass: null },
      ],
    });

    expect(created.id).toBe("7");
    expect(created.academicYear).toBe("2026-2027");

    const call = calls[0];
    expect(call?.url).toBe(BASE);
    expect(call?.init?.method).toBe("POST");
    expect(parseBody(call?.init)).toEqual({
      academic_year: "2026-2027",
      notes: "Sommer-Wechsel",
      // null to_class is the Abgang marker and must survive JSON.stringify —
      // dropping it would silently turn a graduation into an unmapped class.
      mappings: [
        { from_class: "1a", to_class: "2a" },
        { from_class: "4a", to_class: null },
      ],
    });
  });

  it("uses a status fallback while retaining the backend diagnostic", async () => {
    stubOnce(fail(400, { detail: "academic_year is required" }));

    await expect(
      createGradeTransition({ academicYear: "", mappings: [] }),
    ).rejects.toThrow("HTTP 400");
  });

  it("falls back to the status line when the body has no message", async () => {
    stubOnce(fail(502, {}));

    await expect(
      createGradeTransition({ academicYear: "2026-2027", mappings: [] }),
    ).rejects.toThrow("HTTP 502");
  });

  it("falls back to the status line when the body is not JSON", async () => {
    stubOnce(failUnparseable(504));

    await expect(
      createGradeTransition({ academicYear: "2026-2027", mappings: [] }),
    ).rejects.toThrow("HTTP 504");
  });

  it("does not read a legacy `message` key as the diagnostic", async () => {
    stubOnce(fail(400, { message: "ungültiges Schuljahr" }));

    await expect(
      createGradeTransition({ academicYear: "x", mappings: [] }),
    ).rejects.toThrow("HTTP 400");
  });
});

describe("updateGradeTransition", () => {
  it("PUTs to the escaped id and omits mappings when undefined", async () => {
    stubOnce(okData(transitionRow));

    await updateGradeTransition("7", { expectedVersion: "v1", notes: "neu" });

    const call = calls[0];
    expect(call?.url).toBe(`${BASE}/7`);
    expect(call?.init?.method).toBe("PUT");
    // `mappings: undefined` must not appear in the payload at all — the backend
    // treats an explicit [] as "remove every mapping".
    expect(parseBody(call?.init)).toEqual({
      notes: "neu",
      expected_version: "v1",
    });
  });

  it("sends an explicit empty list when mappings are cleared", async () => {
    stubOnce(okData(transitionRow));

    await updateGradeTransition("7", {
      expectedVersion: "v1",
      academicYear: "2027-2028",
      mappings: [],
    });

    expect(parseBody(calls[0]?.init)).toEqual({
      academic_year: "2027-2028",
      mappings: [],
      expected_version: "v1",
    });
  });

  it("escapes the id in the URL", async () => {
    stubOnce(okData(transitionRow));

    await updateGradeTransition("a b/c", { expectedVersion: "v1", notes: "x" });

    expect(calls[0]?.url).toBe(`${BASE}/a%20b%2Fc`);
  });

  it("keeps the not_draft code so the editor can stop offering a retry", async () => {
    stubOnce(
      fail(409, {
        detail: "transition is no longer a draft",
        code: NOT_DRAFT_CODE,
      }),
    );

    await expect(
      updateGradeTransition("7", { expectedVersion: "v1", notes: "x" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: NOT_DRAFT_CODE,
      message: "HTTP 409",
      detail: "transition is no longer a draft",
    });
  });
});

describe("deleteGradeTransition", () => {
  it("DELETEs the escaped id", async () => {
    stubOnce({ ok: true, status: 204 });

    await expect(deleteGradeTransition("7")).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe(`${BASE}/7`);
    expect(calls[0]?.init?.method).toBe("DELETE");
  });

  it("keeps the stable code on a conflict", async () => {
    stubOnce(fail(409, { detail: "already applied", code: NOT_DRAFT_CODE }));

    const err = await deleteGradeTransition("7").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(NOT_DRAFT_CODE);
  });

  it("uses the server class code when the backend sends none", async () => {
    stubOnce(fail(500, { detail: "boom" }));

    const err = await deleteGradeTransition("7").catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("general.server");
    expect((err as ApiError).message).toBe("HTTP 500");
    expect((err as ApiError).detail).toBe("boom");
  });
});

describe("previewGradeTransition", () => {
  const preview: adminContract.TransitionPreviewResponse = {
    transition_id: "7",
    academic_year: "2026-2027",
    total_students: 50,
    to_promote: 40,
    to_graduate: 10,
    by_mapping: [
      {
        from_class: "1a",
        to_class: "2a",
        student_count: 20,
        action: "promote",
      },
    ],
    unmapped_classes: null,
    warnings: null,
    fingerprint: FINGERPRINT,
    parent_targets: null,
  };

  it("GETs the preview uncached and carries the fingerprint through", async () => {
    stubOnce(okData(preview));

    const p = await previewGradeTransition("7");

    expect(calls[0]?.url).toBe(`${BASE}/7/preview`);
    // Uncached: the catalog proxy answers `private, no-store`
    // (catalog-proxy.server.test.ts).
    expect(calls[0]?.init?.method).toBe("GET");
    expect(p.fingerprint).toBe(FINGERPRINT);
    expect(p.unmappedClasses).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it("refuses a bare payload without the { data } envelope", async () => {
    stubOnce(okBare(preview));

    await expect(previewGradeTransition("7")).rejects.toMatchObject({
      status: 502,
      code: "general.unavailable",
    });
  });

  it("uses the status fallback on failure", async () => {
    stubOnce(fail(404, { detail: "transition not found" }));

    await expect(previewGradeTransition("7")).rejects.toThrow("HTTP 404");
  });
});

describe("applyGradeTransition", () => {
  it("binds the call to the confirmed preview via expected_fingerprint", async () => {
    stubOnce(okData(resultRow));

    const r = await applyGradeTransition("7", FINGERPRINT);

    expect(calls[0]?.url).toBe(`${BASE}/7/apply`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(parseBody(calls[0]?.init)).toEqual({
      expected_fingerprint: FINGERPRINT,
    });
    expect(r.studentsPromoted).toBe(40);
    expect(r.studentsGraduated).toBe(10);
    expect(r.canRevert).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("refuses a result sent without the { data } envelope", async () => {
    stubOnce(okBare(resultRow));

    // A write may have happened: the person reloads before trying again.
    await expect(applyGradeTransition("7", FINGERPRINT)).rejects.toMatchObject({
      status: 502,
      code: "general.write_answer_unreadable",
    });
  });

  it("keeps the graduates_checked_in code on a 409", async () => {
    stubOnce(
      fail(409, {
        detail: "2 graduating children are still checked in",
        code: "grade_transition.graduates_checked_in",
      }),
    );

    const err = await applyGradeTransition("7", FINGERPRINT).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(
      "grade_transition.graduates_checked_in",
    );
  });

  it("keeps the preview_stale code on a 409", async () => {
    stubOnce(
      fail(409, { detail: "preview is stale", code: PREVIEW_STALE_CODE }),
    );

    const err = await applyGradeTransition("7", OLDER_FINGERPRINT).catch(
      (e: unknown) => e,
    );
    expect((err as ApiError).code).toBe(PREVIEW_STALE_CODE);
  });

  it("falls back to the status line when the error body is unreadable", async () => {
    stubOnce(failUnparseable(500));

    const err = await applyGradeTransition("7", FINGERPRINT).catch(
      (e: unknown) => e,
    );
    expect((err as ApiError).message).toBe("HTTP 500");
    expect((err as ApiError).code).toBe("general.server");
  });
});

describe("revertGradeTransition", () => {
  // The route carries no request body in its contract; the handler reads none.
  it("POSTs to the revert route without a body", async () => {
    stubOnce(
      okData({ ...resultRow, status: "reverted", warnings: ["hinweis"] }),
    );

    const r = await revertGradeTransition("7");

    expect(calls[0]?.url).toBe(`${BASE}/7/revert`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(r.status).toBe("reverted");
    expect(r.warnings).toEqual(["hinweis"]);
  });

  it("keeps the not_latest_transition code so the caller can reload", async () => {
    stubOnce(
      fail(409, {
        detail: "a newer transition was applied",
        code: NOT_LATEST_TRANSITION_CODE,
      }),
    );

    const err = await revertGradeTransition("7").catch((e: unknown) => e);
    expect((err as ApiError).code).toBe(NOT_LATEST_TRANSITION_CODE);
  });

  // #405 review: reverting a transition another admin already reverted (or
  // that is still a draft) now answers 409 not_applied instead of 500, so the
  // manager can reload the list instead of offering a hopeless retry.
  it("keeps the not_applied code so the caller can reload", async () => {
    stubOnce(
      fail(409, {
        detail: "transition has already been reverted",
        code: NOT_APPLIED_CODE,
      }),
    );

    const err = await revertGradeTransition("7").catch((e: unknown) => e);
    expect((err as ApiError).code).toBe(NOT_APPLIED_CODE);
  });
});

describe("fetchTransitionClasses", () => {
  it("returns the class list", async () => {
    stubOnce(okData(["1a", "2a", "4b"]));

    expect(await fetchTransitionClasses()).toEqual(["1a", "2a", "4b"]);
    expect(calls[0]?.url).toBe(`${BASE}/classes`);
    // Uncached: the catalog proxy answers `private, no-store`
    // (catalog-proxy.server.test.ts).
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("returns an empty list when the payload is null", async () => {
    stubOnce(okData(null));

    expect(await fetchTransitionClasses()).toEqual([]);
  });

  it("uses the status fallback on failure", async () => {
    stubOnce(fail(403, { detail: "forbidden" }));

    await expect(fetchTransitionClasses()).rejects.toThrow("HTTP 403");
  });
});

describe("fetchSuggestedMappings", () => {
  it("maps every suggestion", async () => {
    const suggestions: adminContract.SuggestedMappingResponse[] = [
      {
        from_class: "1a",
        to_class: "2a",
        student_count: 20,
        is_graduating: false,
      },
      {
        from_class: "Vorklasse",
        student_count: 5,
        is_graduating: false,
        ambiguous: true,
      },
    ];
    stubOnce(okData(suggestions));

    const mapped = await fetchSuggestedMappings();

    expect(calls[0]?.url).toBe(`${BASE}/suggest`);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]?.toClass).toBe("2a");
    expect(mapped[1]?.toClass).toBeNull();
    expect(mapped[1]?.ambiguous).toBe(true);
  });

  it("returns an empty list when the payload is null", async () => {
    stubOnce(okData(null));

    expect(await fetchSuggestedMappings()).toEqual([]);
  });
});

describe("fetchTransitionHistory", () => {
  it("maps every ledger row for the escaped id", async () => {
    const rows: adminContract.TransitionHistoryResponse[] = [
      {
        id: "3",
        transition_id: "7",
        student_id: "99",
        person_name: "Mika Muster",
        from_class: "4a",
        to_class: undefined,
        action: "graduated",
        created_at: "2026-08-01T06:00:00Z",
        student_state: "purged",
      },
    ];
    stubOnce(okData(rows));

    const history = await fetchTransitionHistory("7");

    expect(calls[0]?.url).toBe(`${BASE}/7/history`);
    // Uncached: the catalog proxy answers `private, no-store`
    // (catalog-proxy.server.test.ts).
    expect(calls[0]?.init?.method).toBe("GET");
    expect(history[0]?.studentState).toBe("purged");
  });

  it("returns an empty list when the payload is null", async () => {
    stubOnce(okData(null));

    expect(await fetchTransitionHistory("7")).toEqual([]);
  });

  it("uses the status fallback on failure", async () => {
    stubOnce(fail(404, { detail: "transition not found" }));

    await expect(fetchTransitionHistory("7")).rejects.toThrow("HTTP 404");
  });
});

describe("purgeGraduatedStudent", () => {
  it("DELETEs the student purge route with an escaped id", async () => {
    stubOnce({ ok: true, status: 204 });

    await expect(purgeGraduatedStudent("99")).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe("/api/students/99/purge");
    expect(calls[0]?.init?.method).toBe("DELETE");
  });

  it("uses the status fallback on failure", async () => {
    stubOnce(fail(409, { detail: "child is not an alumnus" }));

    await expect(purgeGraduatedStudent("99")).rejects.toThrow("HTTP 409");
  });

  it("falls back to the status line when the body is unreadable", async () => {
    stubOnce(failUnparseable(500));

    await expect(purgeGraduatedStudent("99")).rejects.toThrow("HTTP 500");
  });
});

describe("listGradeTransitions request handling", () => {
  it("requests uncached keyset windows of 100", async () => {
    stubOnce(okPage([transitionRow]));

    await listGradeTransitions();

    expect(calls[0]?.url).toBe(`${BASE}?after_id=0&page_size=100`);
    // Uncached: the catalog proxy answers `private, no-store`
    // (catalog-proxy.server.test.ts).
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("tolerates a null payload", async () => {
    stubOnce(okPage(null));

    expect(await listGradeTransitions()).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("stops at the window limit against a backend that ignores `after_id`", async () => {
    // A backend that returns the same full window forever would otherwise spin
    // this loop without end; the 100-window bound is the safety stop, and the
    // id map keeps the repeated rows from duplicating in the result.
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      ...transitionRow,
      id: String(i + 1),
    }));
    stubOnce(okPage(fullPage));

    const result = await listGradeTransitions();

    expect(calls).toHaveLength(100);
    expect(result).toHaveLength(100);
  });

  it("propagates a failing page", async () => {
    stubOnce(fail(500, { detail: "database unavailable" }));

    await expect(listGradeTransitions()).rejects.toThrow("HTTP 500");
  });
});
