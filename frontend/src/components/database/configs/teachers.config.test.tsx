/**
 * Tests for Teachers Configuration
 * Tests teacher config structure and mapping functions
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { teachersConfig } from "./teachers.config";
import type { Teacher } from "@/lib/teacher-api";

// Mock teacher-api
vi.mock("@/lib/teacher-api", () => ({
  teacherService: {
    createTeacher: vi.fn(),
    updateTeacher: vi.fn(),
  },
}));

describe("teachersConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports a valid entity config", () => {
    expect(teachersConfig).toBeDefined();
    expect(teachersConfig.name).toEqual({
      singular: "Personal",
      plural: "Personal",
    });
  });

  it("has correct API configuration", () => {
    expect(teachersConfig.api.basePath).toBe("/api/staff");
  });

  it("has form sections configured", () => {
    expect(teachersConfig.form.sections).toHaveLength(3);
  });

  it("has required form fields", () => {
    const allFields = teachersConfig.form.sections.flatMap((s) => s.fields);
    const fieldNames = allFields.map((f) => f.name);

    expect(fieldNames).toContain("first_name");
    expect(fieldNames).toContain("last_name");
    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("specialization");
    expect(fieldNames).toContain("password");
  });

  it("has default values", () => {
    expect(teachersConfig.form.defaultValues?.specialization).toBe("");
    expect(teachersConfig.form.defaultValues?.role).toBe("");
  });

  it("validates required fields", () => {
    const validation = teachersConfig.form.validation?.({
      first_name: "",
      last_name: "",
    });

    expect(validation).toBeDefined();
    expect(validation?.first_name).toBeDefined();
    expect(validation?.last_name).toBeDefined();
  });

  it("validates password for new teacher", () => {
    const validation = teachersConfig.form.validation?.({
      first_name: "Max",
      last_name: "Mustermann",
      specialization: "Math",
    });

    expect(validation?.password).toBeDefined();
  });

  it("does not require password for existing teacher", () => {
    const validation = teachersConfig.form.validation?.({
      id: "1",
      first_name: "Max",
      last_name: "Mustermann",
      specialization: "Math",
    });

    expect(validation).toBeNull();
  });

  it("has detail header configuration", () => {
    const mockTeacher: Teacher = {
      id: "1",
      name: "Max Mustermann",
      first_name: "Max",
      last_name: "Mustermann",
      specialization: "Mathematics",
      email: "max@example.com",
    };

    expect(teachersConfig.detail.header?.title(mockTeacher)).toBe(
      "Max Mustermann",
    );
  });

  it("hides demo seed addresses in detail and list renderers", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "demo");
    const demoTeacher: Teacher = {
      id: "1",
      name: "Julia Klein",
      first_name: "Julia",
      last_name: "Klein",
      email: "julia.klein@demo-ogs-nord.moto-ogs.de",
    };
    const emailItem = teachersConfig.detail.sections[0]?.items.find(
      (item) => item.label === "E-Mail",
    );
    const accountItem = teachersConfig.detail.sections[2]?.items.find(
      (item) => item.label === "Konto-Informationen",
    );

    expect(emailItem?.value(demoTeacher)).toBe("–");
    expect(teachersConfig.list.item.description?.(demoTeacher)).toBe("");
    render(<>{accountItem?.value({ ...demoTeacher, account_id: "42" })}</>);
    // Anker: Der Kontobereich ist geladen; nur die technische Adresse fehlt.
    expect(screen.getByText("Konto-ID:")).toBeInTheDocument();
    expect(screen.queryByText("E-Mail:")).not.toBeInTheDocument();
  });

  it("falls back to first_name and last_name", () => {
    const mockTeacher = {
      id: "1",
      first_name: "Max",
      last_name: "Mustermann",
      specialization: "Mathematics",
    } as unknown as Teacher;

    expect(teachersConfig.detail.header?.title(mockTeacher)).toBe(
      "Max Mustermann",
    );
  });

  it("shows specialization and role in subtitle", () => {
    const mockTeacher: Teacher = {
      id: "1",
      name: "Max Mustermann",
      first_name: "Max",
      last_name: "Mustermann",
      specialization: "Mathematics",
      role: "Gruppenleiter",
    };

    const subtitle = teachersConfig.detail.header?.subtitle?.(mockTeacher);
    expect(subtitle).toContain("Mathematics");
    expect(subtitle).toContain("Gruppenleiter");
  });

  it("has list configuration", () => {
    expect(teachersConfig.list.title).toBe("Personal auswählen");
    expect(teachersConfig.list.searchStrategy).toBe("frontend");
  });

  it("displays teacher in list", () => {
    const mockTeacher: Teacher = {
      id: "1",
      name: "Max Mustermann",
      first_name: "Max",
      last_name: "Mustermann",
      specialization: "Mathematics",
    };

    const title = teachersConfig.list.item.title(mockTeacher);
    expect(title).toBe("Max Mustermann");
  });

  it("shows avatar initials", () => {
    const mockTeacher: Teacher = {
      id: "1",
      name: "Max Mustermann",
      first_name: "Max",
      last_name: "Mustermann",
      specialization: "Mathematics",
    };

    const initials = teachersConfig.list.item.avatar?.text(mockTeacher);
    expect(initials).toBe("MM");
  });

  it("has custom labels", () => {
    expect(teachersConfig.labels?.createButton).toBe("Neues Personal anlegen");
    expect(teachersConfig.labels?.deleteConfirmation).toContain("löschen");
  });

  it("has onCreateSuccess callback", () => {
    expect(teachersConfig.onCreateSuccess).toBeDefined();
  });

  describe("service.create handler", () => {
    it("returns teacher data on successful creation", async () => {
      const consoleDebug = vi
        .spyOn(console, "debug")
        .mockImplementation(() => {});
      const { teacherService } = await import("@/lib/teacher-api");
      const createFn = teacherService.createTeacher;
      const mockedCreate = vi.mocked(createFn);

      const mockTeacher: Teacher = {
        id: "42",
        name: "Test Teacher",
        first_name: "Test",
        last_name: "Teacher",
        email: "test@example.com",
      };

      mockedCreate.mockResolvedValueOnce({
        status: "created",
        data: {
          ...mockTeacher,
          temporaryCredentials: { email: "test@example.com", password: "pass" },
        },
      });

      const result = await teachersConfig.service!.create!({
        first_name: "Test",
        last_name: "Teacher",
        password: "SecurePass123!",
      } as Record<string, unknown>);

      expect(result).toMatchObject({
        id: "42",
        first_name: "Test",
      });
      expect(consoleDebug).toHaveBeenCalledWith("teacher_create_started", {
        link_existing: false,
      });
      expect(JSON.stringify(consoleDebug.mock.calls)).not.toContain(
        "SecurePass123!",
      );
      consoleDebug.mockRestore();
    });

    it("returns account_exists result as Teacher-shaped object", async () => {
      const { teacherService } = await import("@/lib/teacher-api");
      const createFn = teacherService.createTeacher;
      const mockedCreate = vi.mocked(createFn);

      mockedCreate.mockResolvedValueOnce({
        status: "account_exists",
        email: "exists@example.com",
      });

      const result = await teachersConfig.service!.create!({
        first_name: "Exists",
        last_name: "User",
        password: "SecurePass123!",
      } as Record<string, unknown>);

      // The handler casts the result to Teacher — verify the shape is preserved
      const typed = result as unknown as { status: string; email: string };
      expect(typed.status).toBe("account_exists");
      expect(typed.email).toBe("exists@example.com");
    });
  });

  // The list and the record answer staff records of the contract (#7563);
  // the person is nested and ids are decimal strings.
  it("maps the nested person of a contract record including avatar and account id", () => {
    const mapped = teachersConfig.service?.mapResponse?.({
      started_on: "2024-09-02",
      ended_on: null,
      id: "42",
      person_id: "7",
      account_role: "admin",
      specialization: "Mathematik",
      is_teacher: true,
      was_present_today: false,
      is_external: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      person: {
        id: "7",
        account_id: "55",
        email: "nested@example.com",
        first_name: "Nora",
        last_name: "Nested",
        avatar: "/uploads/avatars/global/nora.jpg",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
    }) as Teacher;

    expect(mapped).toMatchObject({
      id: "42",
      name: "Nora Nested",
      first_name: "Nora",
      last_name: "Nested",
      email: "nested@example.com",
      avatar: "/uploads/avatars/global/nora.jpg",
      account_role: "admin",
      account_id: "55",
      person_id: "7",
    });
  });

  it("forwards update calls to the teacher service", async () => {
    const { teacherService } = await import("@/lib/teacher-api");
    const updateFn = teacherService.updateTeacher;
    const mockedUpdate = vi.mocked(updateFn);

    mockedUpdate.mockResolvedValueOnce({
      id: "7",
      first_name: "Updated",
      last_name: "Teacher",
    } as Teacher);

    const current: Teacher = {
      id: "7",
      name: "Original Teacher",
      first_name: "Original",
      last_name: "Teacher",
      person_id: "9007199254740993",
      is_teacher: false,
    };
    const result = await teachersConfig.service!.update!(
      "7",
      {
        first_name: "Updated",
        last_name: "Teacher",
      },
      current,
    );

    expect(mockedUpdate).toHaveBeenCalledWith(
      "7",
      {
        first_name: "Updated",
        last_name: "Teacher",
      },
      current,
    );
    expect(result).toMatchObject({
      id: "7",
      first_name: "Updated",
    });
  });

  it("returns undefined when creation succeeds without temporary credentials", () => {
    const result = teachersConfig.onCreateSuccess?.({
      id: "5",
      first_name: "Ohne",
      last_name: "Zugangsdaten",
    } as Teacher);

    expect(result).toBeUndefined();
  });
});
