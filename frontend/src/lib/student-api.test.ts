import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { ApiError } from "./api-error";
import { buildBackendStudent } from "~/test/fixtures/students";
import type { StudentDetailResponse } from "./contract/students.generated";
import { subscribeStudentCompanionsChanged } from "./student-companion-api";
import {
  createStudent,
  deleteStudentPhoto,
  deleteStudentWithData,
  fetchCareOfferingOptions,
  fetchEnrollmentAnswerFilters,
  fetchPrivacyConsentDefaults,
  fetchSchoolClasses,
  fetchStudent,
  fetchStudentDeletionImpact,
  fetchStudentEnrollmentExtraFields,
  fetchStudentPrivacyConsent,
  fetchStudents,
  fetchAllStudentNames,
  updateStudent,
  uploadStudentPhoto,
} from "./student-api";
import {
  CompanionPlanConflictError,
  isCompanionDepartureRefusal,
  isCompanionsChanged,
  isPrivacyConsentSaved,
} from "./student-update-errors";
import {
  mapStudentDetailResponse,
  mapStudentListRow,
  mapStudentResponse,
} from "./student-wire";

/** A route-wrapper success answer. */
function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ status: "success", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function problem(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

/** A paginated answer of the catalog proxy: the page beside the data. */
function pageOf(data: unknown[], pagination: unknown): Response {
  return Response.json({ status: "success", data, pagination });
}

function calledUrl(index = 0): string {
  return fetchMock.mock.calls[index]![0];
}

function calledInit(index = 0): RequestInit {
  return fetchMock.mock.calls[index]![1] ?? {};
}

const page = {
  current_page: 1,
  page_size: 50,
  total_pages: 3,
  total_records: 120,
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("fetchStudents", () => {
  it("loads every names page for a complete child selection", async () => {
    const first = { id: "1", first_name: "Lina", last_name: "Muster" };
    const last = { id: "501", first_name: "Zoe", last_name: "Weber" };
    fetchMock
      .mockResolvedValueOnce(
        pageOf([first], {
          ...page,
          page_size: 500,
          total_pages: 2,
          total_records: 501,
        }),
      )
      .mockResolvedValueOnce(
        pageOf([last], {
          ...page,
          current_page: 2,
          page_size: 500,
          total_pages: 2,
          total_records: 501,
        }),
      );

    await expect(fetchAllStudentNames()).resolves.toEqual([
      mapStudentListRow(first, "names"),
      mapStudentListRow(last, "names"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [index, expectedPage] of [
      [0, "1"],
      [1, "2"],
    ] as const) {
      const params = new URL(calledUrl(index), "http://localhost").searchParams;
      expect(Object.fromEntries(params)).toEqual({
        page: expectedPage,
        page_size: "500",
        view: "names",
      });
    }
  });

  it("reports a later names-page failure instead of returning a partial selection", async () => {
    fetchMock
      .mockResolvedValueOnce(
        pageOf([{ id: "1", first_name: "Lina", last_name: "Muster" }], {
          ...page,
          total_pages: 2,
        }),
      )
      .mockResolvedValueOnce(
        problem(503, { status: 503, code: "general.unavailable" }),
      );
    await expect(fetchAllStudentNames()).rejects.toBeInstanceOf(ApiError);
  });

  it("maps the full rows once and keeps the page", async () => {
    const row = buildBackendStudent({ id: "1", first_name: "Max" });
    fetchMock.mockResolvedValueOnce(pageOf([row], page));

    await expect(fetchStudents()).resolves.toEqual({
      students: [mapStudentResponse(row)],
      pagination: page,
    });
    expect(calledUrl()).toBe("/api/students");
  });

  it("maps a slim row as the slim projection", async () => {
    const row = {
      ...buildBackendStudent({ id: "7" }),
      departure_modes: ["bus"],
    };
    fetchMock.mockResolvedValueOnce(pageOf([row], page));

    const { students } = await fetchStudents({ view: "slim" });
    expect(students).toEqual([mapStudentListRow(row, "slim")]);
    // The slim projection synthesizes no full-detail field.
    expect(students[0]).not.toHaveProperty("bus_days");
  });

  it("sends every filter under its backend name", async () => {
    fetchMock.mockResolvedValueOnce(pageOf([], page));

    await fetchStudents({
      search: "Max",
      groupId: ["5", "a,b"],
      schoolClass: "3a",
      gradeLevel: ["1", "2"],
      roomId: "42",
      locationState: "present",
      dayStatus: "comes_today",
      date: "2026-09-10",
      bus: "yes",
      photoConsent: "no",
      pickupStatus: "self",
      careOfferingId: "9",
      page: 2,
      pageSize: 200,
      includePickupTimes: true,
      includeArrivalTimes: true,
      includeCompanions: true,
      includePendingWithdrawals: true,
      view: "slim",
    });

    const params = new URL(calledUrl(), "http://x").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      search: "Max",
      group_id: "5,a\\,b",
      school_class: "3a",
      grade_level: "1,2",
      room_id: "42",
      location_state: "present",
      day_status: "comes_today",
      date: "2026-09-10",
      bus: "yes",
      photo_consent: "no",
      pickup_status: "self",
      care_offering_id: "9",
      page: "2",
      page_size: "200",
      include_pickup_times: "true",
      include_arrival_times: "true",
      include_companions: "true",
      include_pending_withdrawals: "true",
      view: "slim",
    });
  });

  it("leaves unset and empty filters out", async () => {
    fetchMock.mockResolvedValueOnce(pageOf([], page));

    await fetchStudents({
      search: "",
      groupId: [],
      includePickupTimes: false,
      page: 0,
    });

    expect(calledUrl()).toBe("/api/students");
  });

  it("keeps the code of a refused list for the shared error path", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(403, { status: 403, code: "general.permission" }),
    );

    await expect(fetchStudents()).rejects.toMatchObject({
      status: 403,
      code: "general.permission",
    });
  });
});

describe("child list filter options", () => {
  const answer = (data: unknown) =>
    new Response(JSON.stringify({ status: "success", data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("maps the care offerings of the contract", async () => {
    fetchMock.mockResolvedValueOnce(
      answer([{ id: "12", name: "OGS Ganztag" }]),
    );

    await expect(fetchCareOfferingOptions()).resolves.toEqual([
      { id: "12", name: "OGS Ganztag" },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/students/care-offerings");
  });

  it("maps the registration questions without their type", async () => {
    fetchMock.mockResolvedValueOnce(
      answer([
        {
          key: "bus",
          label: "Fährt mit dem Bus",
          type: "boolean",
          options: [{ value: "true", label: "Ja", count: 3 }],
        },
        { key: "lunch", label: "Mittagessen", type: "choice", options: null },
      ]),
    );

    await expect(fetchEnrollmentAnswerFilters()).resolves.toEqual([
      {
        key: "bus",
        label: "Fährt mit dem Bus",
        options: [{ value: "true", label: "Ja", count: 3 }],
      },
      { key: "lunch", label: "Mittagessen", options: [] },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/api/students/enrollment-answer-filters",
    );
  });
});

describe("single reads", () => {
  it("reads the school classes", async () => {
    fetchMock.mockResolvedValueOnce(ok(["1a", "2b"]));

    await expect(fetchSchoolClasses()).resolves.toEqual(["1a", "2b"]);
    expect(calledUrl()).toBe("/api/students/school-classes");
  });

  it("reads one child with its consent under its encoded id", async () => {
    const detail = {
      ...buildBackendStudent({ id: "7" }),
      has_write_access: true,
      privacy_consent: { accepted: true, data_retention_days: 14 },
    } as StudentDetailResponse;
    fetchMock.mockResolvedValueOnce(ok(detail));

    const student = await fetchStudent("7/x");
    expect(student).toEqual(mapStudentDetailResponse(detail));
    expect(student).toMatchObject({
      has_write_access: true,
      privacy_consent_accepted: true,
      data_retention_days: 14,
    });
    // One read carries the consent: no second request.
    expect(calledUrl()).toBe(
      "/api/students/7%2Fx?include_privacy_consent=true",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reads the enrollment extra fields of a child", async () => {
    const groups = [
      { request_id: "1", phase_name: "2026", submitted_at: "", fields: [] },
    ];
    fetchMock.mockResolvedValueOnce(ok(groups));

    await expect(fetchStudentEnrollmentExtraFields("7")).resolves.toEqual(
      groups,
    );
    expect(calledUrl()).toBe("/api/students/7/enrollment-extra-fields");
  });
});

/** The stored consent the backend answers after a write. */
function consentAnswer(
  accepted: boolean,
  days: number,
  version = "v",
): Response {
  return ok({ accepted, data_retention_days: days, version });
}

describe("createStudent", () => {
  const created = buildBackendStudent({ id: "55", first_name: "Mia" });

  it("creates the child with the trimmed names and leaves an unchanged consent alone", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(created, 201))
      .mockResolvedValueOnce(consentAnswer(false, 30));

    const student = await createStudent({
      first_name: "  Mia ",
      second_name: " Muster",
      school_class: "2b ",
      guardians: [],
    });

    expect(calledUrl(0)).toBe("/api/students");
    expect(calledInit(0)).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(calledInit(0).body))).toMatchObject({
      first_name: "Mia",
      last_name: "Muster",
      school_class: "2b",
    });
    // Without a changed consent only the read-back follows.
    expect(calledUrl(1)).toBe("/api/students/55/privacy-consent");
    expect(calledInit(1).method ?? "GET").toBe("GET");
    expect(student).toEqual({
      ...mapStudentResponse(created),
      privacy_consent_accepted: false,
      data_retention_days: 30,
    });
    expect(student).not.toHaveProperty("privacy_consent_saved");
  });

  // The create modal's whole Heimweg plan has to reach the BFF: a former
  // mapRequest dropped departure_days from the body.
  it("sends the departure plan of the create modal", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(created, 201))
      .mockResolvedValueOnce(consentAnswer(false, 30));

    await createStudent({
      first_name: "Mia",
      second_name: "Muster",
      school_class: "2b",
      departure_days: { mon: "pickup", tue: "bus" },
      allowed_departure_modes: { mon: ["pickup"], tue: ["bus", "alone"] },
    });

    expect(JSON.parse(String(calledInit(0).body))).toMatchObject({
      departure_days: { mon: "pickup", tue: "bus" },
      allowed_departure_modes: { mon: ["pickup"], tue: ["alone", "bus"] },
    });
  });

  it("writes the changed consent after the child and carries no marker", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(created, 201))
      .mockResolvedValueOnce(consentAnswer(false, 30, "nothing-recorded"))
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(consentAnswer(true, 14));

    const student = await createStudent({
      first_name: "Mia",
      second_name: "Muster",
      school_class: "2b",
      privacy_consent_accepted: true,
      data_retention_days: 14,
    });

    // The new child's consent is written against the state read right after
    // creating it (ADR 0311).
    expect(calledUrl(1)).toBe("/api/students/55/privacy-consent");
    expect(calledInit(1).method ?? "GET").toBe("GET");
    expect(calledUrl(2)).toBe("/api/students/55/privacy-consent");
    expect(calledInit(2)).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(calledInit(2).body))).toEqual({
      expected_version: "nothing-recorded",
      policy_version: "1.0",
      accepted: true,
      data_retention_days: 14,
    });
    expect(student).toMatchObject({
      privacy_consent_accepted: true,
      data_retention_days: 14,
    });
    expect(student).not.toHaveProperty("privacy_consent_saved");
  });

  it("answers the child with the stored consent when the consent write fails", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(created, 201))
      .mockResolvedValueOnce(consentAnswer(false, 30))
      .mockResolvedValueOnce(
        problem(500, { status: 500, code: "general.internal" }),
      )
      .mockResolvedValueOnce(consentAnswer(false, 30));

    const student = await createStudent({
      first_name: "Mia",
      second_name: "Muster",
      school_class: "2b",
      privacy_consent_accepted: true,
      data_retention_days: 14,
    });

    expect(student).toMatchObject({
      id: "55",
      privacy_consent_accepted: false,
      data_retention_days: 30,
      privacy_consent_saved: false,
    });
  });

  it("keeps the field errors of a refused create", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(400, {
        status: 400,
        code: "general.input",
        errors: [{ field: "last_name", reason: "required" }],
      }),
    );

    await expect(
      createStudent({ first_name: "Mia", school_class: "2b" }),
    ).rejects.toMatchObject({
      status: 400,
      errors: [{ field: "last_name", reason: "required" }],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("updateStudent", () => {
  let listener: ReturnType<typeof vi.fn<() => void>>;
  let unsubscribe: () => void;
  const updated = buildBackendStudent({
    id: "1",
    first_name: "Max",
    last_name: "Mustermann",
    tag_id: "TAG001",
    sick: true,
  });

  beforeEach(() => {
    listener = vi.fn<() => void>();
    unsubscribe = subscribeStudentCompanionsChanged(listener);
  });

  afterEach(() => unsubscribe());

  it("sends the backend body and maps the answered child once", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(updated))
      .mockResolvedValueOnce(problem(403, { status: 403 }));

    const result = await updateStudent("1", { sick: true });

    // A consent the caller may not read leaves the keys out.
    expect(result).toEqual(mapStudentResponse(updated));
    expect(result).toMatchObject({
      second_name: "Mustermann",
      studentId: "TAG001",
    });
    expect(calledUrl()).toBe("/api/students/1");
    expect(calledInit()).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(calledInit().body))).toEqual({ sick: true });
  });

  it("writes a sent consent pair before the child", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(updated))
      .mockResolvedValueOnce(consentAnswer(true, 21));

    const result = await updateStudent("1", {
      first_name: "Max",
      privacy_consent_accepted: true,
      data_retention_days: 21,
      privacy_consent_version: "consent-read",
      version: "record-read",
    });

    // Each write carries the version of the read it was built on (ADR 0311).
    expect(calledUrl(0)).toBe("/api/students/1/privacy-consent");
    expect(calledInit(0)).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(calledInit(0).body))).toMatchObject({
      expected_version: "consent-read",
    });
    expect(calledUrl(1)).toBe("/api/students/1");
    // The consent pair does not travel with the child.
    expect(JSON.parse(String(calledInit(1).body))).toEqual({
      first_name: "Max",
      expected_version: "record-read",
    });
    expect(result).toMatchObject({
      privacy_consent_accepted: true,
      data_retention_days: 21,
    });
  });

  it("refuses a lone consent field instead of resetting the other", async () => {
    await expect(
      updateStudent("1", { privacy_consent_accepted: true }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers the consent refusal and does not touch the child", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(400, { status: 400, code: "general.input" }),
    );

    const failure = await updateStudent("1", {
      privacy_consent_accepted: true,
      data_retention_days: 99,
    }).catch((err: unknown) => err);

    expect(failure).toMatchObject({ status: 400 });
    expect(isPrivacyConsentSaved(failure)).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("still succeeds with the written pair when the read-back fails", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(updated))
      .mockResolvedValueOnce(problem(503, { status: 503 }));

    await expect(
      updateStudent("1", {
        privacy_consent_accepted: false,
        data_retention_days: 7,
      }),
    ).resolves.toMatchObject({
      privacy_consent_accepted: false,
      data_retention_days: 7,
    });
  });

  // An open Laufgemeinschaft form answers the announcement by discarding its
  // draft, so only a write that changed the links announces one.
  it("follows the backend's verdict on the companion links", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ ...updated, companions_changed: false }))
      .mockResolvedValueOnce(problem(403, { status: 403 }))
      .mockResolvedValueOnce(ok({ ...updated, companions_changed: true }))
      .mockResolvedValueOnce(problem(403, { status: 403 }));

    await updateStudent("1", { departure_days: { mon: "accompanied" } });
    expect(listener).not.toHaveBeenCalled();

    await updateStudent("1", { first_name: "Updated" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ companions: [] }, true],
    [{ departure_days: { mon: "bus" } }, true],
    [{ first_name: "Updated" }, false],
  ] as const)(
    "judges from the update %j when the backend sends no verdict",
    async (update, announced) => {
      fetchMock
        .mockResolvedValueOnce(ok(updated))
        .mockResolvedValueOnce(problem(403, { status: 403 }));

      await updateStudent("1", update as never);
      expect(listener).toHaveBeenCalledTimes(announced ? 1 : 0);
    },
  );

  // The student PUT answers 409 for several unrelated reasons. Only the one
  // carrying a conflict list is the question the caller can answer with
  // extend_companion_plans.
  it("types only a 409 carrying conflicts as the companion question", async () => {
    fetchMock
      .mockResolvedValueOnce(
        problem(409, {
          detail: "linked child may not walk along",
          conflicts: [{ student_id: 42, weekdays: ["mon"] }],
        }),
      )
      .mockResolvedValueOnce(
        problem(409, {
          detail: "a student cannot be both sick and excused",
          code: "students.sick_excused_conflict",
        }),
      );

    const conflict = await updateStudent("1", { first_name: "A" }).catch(
      (err: unknown) => err,
    );
    expect(conflict).toBeInstanceOf(CompanionPlanConflictError);
    expect(conflict).toMatchObject({
      status: 409,
      conflicts: [{ companion_student_id: "42", weekdays: ["mon"] }],
    });

    const sickExcused = await updateStudent("1", { first_name: "A" }).catch(
      (err: unknown) => err,
    );
    expect(sickExcused).not.toBeInstanceOf(CompanionPlanConflictError);
    expect(sickExcused).toMatchObject({
      status: 409,
      code: "students.sick_excused_conflict",
    });
  });

  it("recognises the stranded-companion and stale-list refusals by code", async () => {
    fetchMock
      .mockResolvedValueOnce(
        problem(400, {
          status: 400,
          detail: "removing the link would strand a linked companion",
          code: "students.companion_would_lose_departure",
        }),
      )
      .mockResolvedValueOnce(
        problem(400, { status: 400, detail: "invalid", code: "general.input" }),
      )
      .mockResolvedValueOnce(
        problem(409, {
          status: 409,
          detail: "companion list changed since it was loaded",
          code: "students.companions_changed",
        }),
      );

    const stranded = await updateStudent("1", {}).catch((err: unknown) => err);
    const otherBadRequest = await updateStudent("1", {}).catch(
      (err: unknown) => err,
    );
    const stale = await updateStudent("1", {}).catch((err: unknown) => err);

    expect(stranded).toBeInstanceOf(ApiError);
    expect(isCompanionDepartureRefusal(stranded)).toBe(true);
    expect(isCompanionDepartureRefusal(otherBadRequest)).toBe(false);
    expect(stale).not.toBeInstanceOf(CompanionPlanConflictError);
    expect(isCompanionsChanged(stale)).toBe(true);
    // The current backend refuses a stale list with the read-state code.
    expect(
      isCompanionsChanged(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      ),
    ).toBe(true);
    expect(isCompanionsChanged(otherBadRequest)).toBe(false);
  });

  // A refused child write on top of a committed consent write says which
  // half landed; everything the form branches on stays as sent.
  it("marks every refusal after a committed consent write", async () => {
    const consent = { privacy_consent_accepted: true, data_retention_days: 30 };
    fetchMock
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(
        problem(409, {
          detail: "companion may not walk along on this day",
          conflicts: [{ student_id: 7, weekdays: ["mon"] }],
          details: { other: 1 },
        }),
      )
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(
        problem(409, { code: "students.companions_changed" }),
      )
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(problem(503, { status: 503 }));

    const conflict = await updateStudent("1", consent).catch(
      (err: unknown) => err,
    );
    const stale = await updateStudent("1", consent).catch(
      (err: unknown) => err,
    );
    const unavailable = await updateStudent("1", consent).catch(
      (err: unknown) => err,
    );

    expect(conflict).toBeInstanceOf(CompanionPlanConflictError);
    expect(conflict).toMatchObject({
      status: 409,
      details: { other: 1, privacy_consent_saved: true },
    });
    expect(isPrivacyConsentSaved(conflict)).toBe(true);
    expect(isCompanionsChanged(stale)).toBe(true);
    expect(isPrivacyConsentSaved(stale)).toBe(true);
    expect(unavailable).toMatchObject({ status: 503 });
    expect(isPrivacyConsentSaved(unavailable)).toBe(true);
  });

  it("leaves a refusal unmarked when no consent was written", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(409, { code: "students.companions_changed" }),
    );

    const failure = await updateStudent("1", {}).catch((err: unknown) => err);
    expect(isPrivacyConsentSaved(failure)).toBe(false);
  });
});

describe("guarded student deletion", () => {
  const input = {
    expected_fingerprint: "abc",
    confirmation_name: "Mia Muster",
    reason: "test_data" as const,
    acknowledged: true as const,
  };

  it("loads the deletion impact under the encoded id", async () => {
    const impact = { fingerprint: "abc", total: 0 };
    fetchMock.mockResolvedValueOnce(ok(impact));

    await expect(fetchStudentDeletionImpact("42/unsafe")).resolves.toEqual(
      impact,
    );
    expect(calledUrl()).toBe("/api/students/42%2Funsafe/delete-impact");
  });

  it("uses the completion-scoped deletion endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ fingerprint: "abc" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await fetchStudentDeletionImpact("42", "73");
    await deleteStudentWithData("42", input, "73");

    expect(calledUrl(0)).toBe(
      "/api/students/care-withdrawals/73/deletion-impact",
    );
    expect(calledUrl(1)).toBe("/api/students/care-withdrawals/73");
  });

  it("sends every confirmation field in the DELETE body", async () => {
    fetchMock.mockResolvedValueOnce(ok({ success: true }));

    await deleteStudentWithData("42", input);

    expect(calledUrl()).toBe("/api/students/42");
    expect(calledInit()).toMatchObject({
      method: "DELETE",
      body: JSON.stringify(input),
    });
  });

  it("keeps the conflict code and diagnostics of a stale preview", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(409, {
        status: 409,
        detail: "Vorschau veraltet",
        code: "students.deletion_preview_changed",
      }),
    );

    await expect(deleteStudentWithData("42", input)).rejects.toMatchObject({
      status: 409,
      detail: "Vorschau veraltet",
      code: "students.deletion_preview_changed",
    });
  });
});

describe("student photo", () => {
  it("posts the photo as multipart form data and answers its URL", async () => {
    fetchMock.mockResolvedValueOnce(ok({ photo_url: "/uploads/p.jpg" }));

    const result = await uploadStudentPhoto(
      "7",
      new Blob(["x"], { type: "image/png" }),
      { consentAcknowledged: true },
    );

    expect(result).toEqual({ photoUrl: "/uploads/p.jpg" });
    expect(calledUrl()).toBe("/api/students/7/photo");
    const body = calledInit().body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get("photo") as File).type).toBe("image/png");
    expect(body.get("consent_acknowledged")).toBe("true");
  });

  it("keeps the file name of a File and sends no consent unasked", async () => {
    fetchMock.mockResolvedValueOnce(ok({ photo_url: "/uploads/p.jpg" }));

    await uploadStudentPhoto(
      "7",
      new File(["x"], "mia.jpg", { type: "image/jpeg" }),
    );

    const body = calledInit().body as FormData;
    expect((body.get("photo") as File).name).toBe("mia.jpg");
    expect(body.has("consent_acknowledged")).toBe(false);
  });

  it("keeps code and request ID of a failed upload", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(400, {
        status: 400,
        code: "general.input",
        instance: "req-1",
      }),
    );

    await expect(
      uploadStudentPhoto("7", new Blob(["x"])),
    ).rejects.toMatchObject({
      status: 400,
      code: "general.input",
      instance: "req-1",
    });
  });

  it("deletes the photo", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(deleteStudentPhoto("7")).resolves.toBeUndefined();
    expect(calledUrl()).toBe("/api/students/7/photo");
    expect(calledInit()).toMatchObject({ method: "DELETE" });
  });
});

describe("privacy consent", () => {
  it("maps the stored consent", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        id: 1,
        student_id: 7,
        policy_version: "1.0",
        accepted: true,
        accepted_at: "2026-01-15T10:00:00Z",
        renewal_required: false,
        data_retention_days: 21,
        created_at: "2026-01-15T10:00:00Z",
        updated_at: "2026-01-15T10:00:00Z",
      }),
    );

    const consent = await fetchStudentPrivacyConsent("7");

    expect(calledUrl()).toBe("/api/students/7/privacy-consent");
    expect(consent).toEqual({ accepted: true, dataRetentionDays: 21 });
  });

  it("maps the school's defaults of a child without a stored consent", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        policy_version: "1.0",
        accepted: false,
        renewal_required: true,
        data_retention_days: 14,
      }),
    );

    await expect(fetchStudentPrivacyConsent("7")).resolves.toMatchObject({
      accepted: false,
      dataRetentionDays: 14,
    });
  });

  it("reads the defaults a new child starts with", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ policy_version: "1.0", accepted: false, data_retention_days: 12 }),
    );

    await expect(fetchPrivacyConsentDefaults()).resolves.toEqual({
      accepted: false,
      dataRetentionDays: 12,
    });
    expect(calledUrl()).toBe("/api/students/privacy-consent/defaults");
  });
});
