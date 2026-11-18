import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Student } from "~/lib/student-helpers";

const mocks = vi.hoisted(() => ({ fetchStudents: vi.fn() }));
vi.mock("~/lib/student-api", () => ({ fetchStudents: mocks.fetchStudents }));

import { fetchStudentChoices } from "./student-choice-list";

function student(id: string, name: string, schoolClass: string): Student {
  return { id, name, school_class: schoolClass } as Student;
}

describe("fetchStudentChoices", () => {
  beforeEach(() => {
    mocks.fetchStudents.mockReset();
  });

  it("reads every page and sorts the children by German name order", async () => {
    mocks.fetchStudents
      .mockResolvedValueOnce({
        students: [student("2", "Özge Yılmaz", "2a")],
        pagination: { total_pages: 2 },
      })
      .mockResolvedValueOnce({
        students: [student("1", "Anna Zander", "1b")],
        pagination: { total_pages: 2 },
      });

    await expect(fetchStudentChoices()).resolves.toEqual([
      { id: "1", name: "Anna Zander", detail: "1b" },
      { id: "2", name: "Özge Yılmaz", detail: "2a" },
    ]);
    expect(mocks.fetchStudents).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 100,
    });
    expect(mocks.fetchStudents).toHaveBeenNthCalledWith(2, {
      page: 2,
      pageSize: 100,
    });
  });
});
