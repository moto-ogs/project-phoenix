import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Teacher } from "./teacher-api";
import type { StaffRecordResponse } from "./contract/staff.generated";
import { suppressConsole } from "~/test/helpers/console";
import { mockSessionData } from "~/test/mocks/next-auth";

// Mock next-auth/react before importing the module
vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
}));

// Import after mocks are set up
import { getSession } from "next-auth/react";
import { ApiError } from "./api-error";
import { teacherService } from "./teacher-api";

// Type for mocked functions
const mockedGetSession = vi.mocked(getSession);

// Sample teacher data
const sampleTeacher: Teacher = {
  id: "1",
  name: "Max Mustermann",
  first_name: "Max",
  last_name: "Mustermann",
  email: "max.mustermann@school.local",
  specialization: "Mathematics",
  role: "Teacher",
  qualifications: "M.Ed",
  tag_id: "TAG001",
  staff_notes: "Senior teacher",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-15T00:00:00Z",
  person_id: "100",
  account_id: "50",
  is_teacher: true,
  staff_id: "1",
  teacher_id: "10",
  // Die Stände der Lesung (ADR 0311); die Speicherungen senden sie zurück.
  version: "record-v1",
  person_version: "person-v1",
};

// The staff record the staff writes answer, as the contract delivers it
// (#7563).
const sampleStaffRecord: StaffRecordResponse = {
  started_on: "2024-01-01",
  ended_on: null,
  id: "1",
  person_id: "100",
  person: {
    id: "100",
    first_name: "Max",
    last_name: "Mustermann",
    email: "max.mustermann@school.local",
    tag_id: "TAG001",
    account_id: "50",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-15T00:00:00Z",
    version: "person-version",
  },
  specialization: "Mathematics",
  role: "Teacher",
  qualifications: "M.Ed",
  staff_notes: "Senior teacher",
  is_teacher: true,
  was_present_today: false,
  is_external: false,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-15T00:00:00Z",
  teacher_id: "10",
};

const sampleTeacherMinimal: Teacher = {
  id: "2",
  name: "Anna Schmidt",
  first_name: "Anna",
  last_name: "Schmidt",
};

describe("teacher-api", () => {
  const consoleSpies = suppressConsole("error", "warn");
  let originalFetch: typeof fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();

    // Default session mock
    mockedGetSession.mockResolvedValue(mockSessionData());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("teacherService.updateTeacher", () => {
    it("sends a staff-only update without a preceding detail GET", async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: sampleStaffRecord })),
        ),
      );

      const result = await teacherService.updateTeacher(
        "1",
        {
          specialization: "Physics",
        },
        sampleTeacher,
      );

      expect(result.id).toBe("1");
      expect(
        mockFetch.mock.calls.map(([url, init]) => [url, init?.method]),
      ).toEqual([["/api/staff/1", "PUT"]]);
      expect(JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)).toEqual({
        expected_version: "record-v1",
        person_id: "100",
        is_teacher: true,
        specialization: "Physics",
        staff_notes: "Senior teacher",
        role: "Teacher",
        qualifications: "M.Ed",
      });
    });

    it.each([
      { is_teacher: false, teacher_id: undefined, expected: false },
      { is_teacher: undefined, teacher_id: undefined, expected: false },
      { is_teacher: undefined, teacher_id: "10", expected: true },
    ])(
      "keeps the loaded profile state on a name correction: %j",
      async ({ expected, ...profile }) => {
        const mockFetch = vi.mocked(globalThis.fetch);
        mockFetch.mockImplementation(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                data: {
                  ...sampleStaffRecord,
                  person: {
                    ...sampleStaffRecord.person!,
                    account_id: "9007199254740993",
                  },
                },
              }),
            ),
          ),
        );

        await teacherService.updateTeacher(
          "1",
          { first_name: "Milena" },
          { ...sampleTeacher, ...profile },
        );

        expect(
          mockFetch.mock.calls.map(([url, init]) => [url, init?.method]),
        ).toEqual([
          ["/api/users/100", "PUT"],
          ["/api/staff/1", "PUT"],
        ]);
        // The person update omits account_id: the backend keeps the stored
        // link (#2352).
        expect(JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)).toEqual(
          { first_name: "Milena", expected_version: "person-v1" },
        );
        expect(JSON.parse(mockFetch.mock.calls[1]![1]!.body as string)).toEqual(
          {
            expected_version: "record-v1",
            person_id: "100",
            is_teacher: expected,
            specialization: "Mathematics",
            staff_notes: "Senior teacher",
            role: "Teacher",
            qualifications: "M.Ed",
          },
        );
      },
    );

    it("sends no person write when the names equal the record read", async () => {
      // Jede Personenschreibung bewegt deren Stand (ADR 0311): ein
      // unveränderter Name ginge sonst bei jedem Speichern mit und lehnte
      // das nächste Speichern desselben Formulars ab.
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: sampleStaffRecord })),
        ),
      );
      const onPersonSaved = vi.fn();

      await teacherService.updateTeacher(
        "1",
        {
          first_name: "Max",
          last_name: "Mustermann",
          tag_id: "TAG001",
          staff_notes: "Neu",
        },
        sampleTeacher,
        { onPersonSaved },
      );

      expect(
        mockFetch.mock.calls.map(([url, init]) => [url, init?.method]),
      ).toEqual([["/api/staff/1", "PUT"]]);
      expect(onPersonSaved).not.toHaveBeenCalled();
    });

    it("reports the saved person with its new version before the staff write", async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                ...sampleStaffRecord.person!,
                first_name: "Milena",
                version: "person-v2",
              },
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ code: "general.unavailable", status: 503 }),
            { status: 503 },
          ),
        );
      const onPersonSaved = vi.fn();

      await expect(
        teacherService.updateTeacher(
          "1",
          { first_name: "Milena", last_name: "Mustermann" },
          sampleTeacher,
          { onPersonSaved },
        ),
      ).rejects.toMatchObject({ status: 503 });

      expect(onPersonSaved).toHaveBeenCalledWith({
        first_name: "Milena",
        last_name: "Mustermann",
        tag_id: "TAG001",
        person_version: "person-v2",
      });
    });

    it.each([null, "", "TAG002"])(
      "preserves tag removal/change: %j",
      async (tag_id) => {
        const mockFetch = vi.mocked(globalThis.fetch);
        mockFetch.mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: sampleStaffRecord })),
          ),
        );

        await teacherService.updateTeacher("1", { tag_id }, sampleTeacher);

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch.mock.calls[0]![0]).toBe("/api/users/100");
        // Go reads null and "" alike for tag_id; removal travels as "".
        expect(JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)).toEqual(
          { tag_id: tag_id ?? "", expected_version: "person-v1" },
        );
      },
    );

    it("clears explicitly empty fields but keeps omitted fields", async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: sampleStaffRecord })),
      );

      await teacherService.updateTeacher(
        "1",
        { specialization: null, role: "  ", qualifications: "" },
        sampleTeacher,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)).toEqual({
        expected_version: "record-v1",
        person_id: "100",
        is_teacher: true,
        specialization: "",
        role: "",
        qualifications: "",
        staff_notes: "Senior teacher",
      });
    });

    it("rejects a mismatched loaded record before writing", async () => {
      await expect(
        teacherService.updateTeacher("2", { role: "New" }, sampleTeacher),
      ).rejects.toThrow("current record ID mismatch");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it.each(["person-write", "staff-write"])(
      "retains permission errors and stops after %s fails",
      async (stage) => {
        const mockFetch = vi.mocked(globalThis.fetch);
        const count = { "person-write": 1, "staff-write": 2 }[stage]!;
        for (let i = 1; i < count; i++) {
          mockFetch.mockResolvedValueOnce(
            new Response(JSON.stringify({ data: { account_id: "50" } })),
          );
        }
        mockFetch.mockResolvedValueOnce(
          new Response(
            JSON.stringify({ code: "general.permission", status: 403 }),
            { status: 403 },
          ),
        );

        await expect(
          teacherService.updateTeacher(
            "1",
            { first_name: "Milena" },
            sampleTeacher,
          ),
        ).rejects.toMatchObject({
          status: 403,
          code: "general.permission",
        });
        expect(mockFetch).toHaveBeenCalledTimes(count);
      },
    );

    it("updates teacher staff fields without person update", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

      // Mock staff update
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { ...sampleStaffRecord, specialization: "Physics" },
          }),
      } as Response);

      const result = await teacherService.updateTeacher(
        "1",
        {
          specialization: "Physics",
        },
        sampleTeacher,
      );

      expect(result.specialization).toBe("Physics");
    });

    it("updates person fields when name/tag changes", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

      // Mock person PUT
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: null }),
      } as Response);

      // Mock staff update
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              ...sampleStaffRecord,
              person: {
                ...sampleStaffRecord.person!,
                first_name: "Maximilian",
              },
            },
          }),
      } as Response);

      const result = await teacherService.updateTeacher(
        "1",
        {
          first_name: "Maximilian",
        },
        sampleTeacher,
      );

      expect(result.first_name).toBe("Maximilian");
    });

    it("edits the person a bigint person_id names, digit for digit", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      // 2^53 + 1 — a JS number would round this to ...992 and edit the person
      // next door instead of failing (#2222).
      const personID = "9007199254740993";

      // person PUT
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: null }),
      } as Response);
      // staff update
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: sampleStaffRecord }),
      } as Response);

      await teacherService.updateTeacher(
        "1",
        { first_name: "Maximilian" },
        { ...sampleTeacher, person_id: personID },
      );

      const personCalls = mockFetch.mock.calls.filter((call) =>
        String(call[0]).startsWith("/api/users/"),
      );
      expect(personCalls).toHaveLength(1);
      for (const call of personCalls) {
        expect(call[0]).toBe(`/api/users/${personID}`);
      }

      const staffCall = mockFetch.mock.calls.find(
        (call) =>
          String(call[0]) === "/api/staff/1" &&
          (call[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(staffCall?.[1]?.body).toContain(`"person_id":"${personID}"`);
    });

    it("throws error when person_id is missing for person update", async () => {
      await expect(
        teacherService.updateTeacher(
          "2",
          { first_name: "Updated" },
          sampleTeacherMinimal,
        ),
      ).rejects.toThrow("Cannot update person fields - person_id not found");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("throws error when person update fails", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

      // Mock person PUT failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve("Validation error"),
      } as Response);

      await expect(
        teacherService.updateTeacher(
          "1",
          { first_name: "Updated" },
          sampleTeacher,
        ),
      ).rejects.toBeInstanceOf(ApiError);
    });

    it("throws error when staff update fails", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

      // Mock staff update failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
        text: () => Promise.resolve("Invalid data"),
      } as Response);

      await expect(
        teacherService.updateTeacher(
          "1",
          { specialization: "New" },
          sampleTeacher,
        ),
      ).rejects.toBeInstanceOf(ApiError);
    });

    it("trims field values before sending", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

      // Mock staff update
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: sampleStaffRecord }),
      } as Response);

      await teacherService.updateTeacher(
        "1",
        {
          specialization: "  Physics  ",
          staff_notes: "  Notes  ",
        },
        sampleTeacher,
      );

      // Verify the PUT call had trimmed values
      expect(mockFetch).toHaveBeenLastCalledWith(
        "/api/staff/1",
        expect.objectContaining({
          body: expect.stringContaining('"specialization":"Physics"'),
        }),
      );
    });
  });

  describe("teacherService.deleteTeacher", () => {
    it("deletes a teacher successfully", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: null }),
      } as Response);

      await teacherService.deleteTeacher("1");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/staff/1",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    it("throws error when delete fails", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
      } as Response);

      await expect(teacherService.deleteTeacher("999")).rejects.toBeInstanceOf(
        ApiError,
      );
    });

    it("logs error on failure", async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(teacherService.deleteTeacher("1")).rejects.toThrow();
      expect(consoleSpies.error).toHaveBeenCalledWith(
        "error deleting teacher",
        { teacher_id: "1", error: expect.stringContaining("Network error") },
      );
    });
  });
});
