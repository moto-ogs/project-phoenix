import { describe, expect, it } from "vitest";
import { TEST_CLOCK_TODAY } from "~/test/clock";
import {
  buildStudentSearchFilters,
  studentNameSearch,
  type StudentSearchFilterInput,
} from "./student-search-resource";

const base: StudentSearchFilterInput = {
  search: "",
  groupIds: [],
  schoolClasses: [],
  years: [],
  roomId: "",
  dayStatus: "all",
  date: TEST_CLOCK_TODAY,
  isToday: true,
  bus: "all",
  photoConsent: "all",
  pickupStatus: "all",
  companions: false,
};

describe("shared student search HTTP projection", () => {
  it("keeps the unfiltered today request slim and omits inactive filters", () => {
    expect(buildStudentSearchFilters(base)).toStrictEqual({
      search: "",
      groupId: [],
      schoolClass: [],
      gradeLevel: [],
      roomId: undefined,
      dayStatus: undefined,
      date: undefined,
      bus: undefined,
      photoConsent: undefined,
      pickupStatus: undefined,
      includePickupTimes: true,
      includeArrivalTimes: true,
      includeCompanions: false,
      view: "slim",
    });
  });
  it("preserves planning, multi-selection and room pagination semantics", () => {
    expect(
      buildStudentSearchFilters({
        ...base,
        search: "Anna",
        groupIds: ["7", "9"],
        schoolClasses: ["1a"],
        years: ["1"],
        roomId: "12",
        dayStatus: "comes_today",
        isToday: false,
        bus: "yes",
        photoConsent: "no",
        pickupStatus: "self",
        companions: true,
      }),
    ).toStrictEqual({
      search: "Anna",
      groupId: ["7", "9"],
      schoolClass: ["1a"],
      gradeLevel: ["1"],
      roomId: "12",
      dayStatus: "comes_today",
      date: base.date,
      bus: "yes",
      photoConsent: "no",
      pickupStatus: "self",
      includePickupTimes: true,
      includeArrivalTimes: true,
      includeCompanions: true,
      view: "slim",
    });
  });
});

// Same cases as the list endpoint's matchesSearchFilter (backend
// presenceprojection): the server export applies that rule to the same term.
describe("studentNameSearch", () => {
  const child = { id: "4711", first_name: "Zoë", second_name: "Özdemir-Groß" };

  it.each([
    ["", true],
    ["zoe", true],
    ["OZDEM", true],
    ["zoe ozdemir", true],
    ["gross", true],
    ["471", true],
    ["ozdemir zoe", false],
    ["mila", false],
    ["zoe ", true],
    ["gross ", false],
  ])("matches %j: %s", (term, expected) => {
    expect(studentNameSearch(term)(child)).toBe(expected);
  });

  it.each([
    ["ΟΣ", "ΟΣΚΑΡ", true],
    ["οσ", "ΟΣ", true],
    ["ος", "ΟΣ", false],
  ])("matches %j in %j like the server: %s", (term, firstName, expected) => {
    expect(studentNameSearch(term)({ ...child, first_name: firstName })).toBe(
      expected,
    );
  });
});
