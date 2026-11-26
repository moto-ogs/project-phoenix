import { describe, expect, it } from "vitest";
import { TEST_CLOCK_TODAY } from "~/test/clock";
import { studentKeys } from "~/lib/swr/portal-keys";
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

it("keeps name terms and hyphenated classes distinct in the cache", () => {
  const params = { ...base, photoState: "photos-disabled" };
  expect(
    studentKeys.search({ ...params, search: "-2", schoolClasses: ["3a"] }),
  ).not.toBe(studentKeys.search({ ...params, schoolClasses: ["2-3a"] }));
});

it("groups only search keys with the same non-name filters", () => {
  const params = {
    ...base,
    groupIds: ["9", "7"],
    schoolClasses: ["3a", "2a"],
    photoState: "photos-disabled",
  };
  const family = studentKeys.searchFamily(params);
  expect(
    studentKeys
      .search({
        ...params,
        groupIds: ["7", "9"],
        schoolClasses: ["2a", "3a"],
        search: "Anna: Lena",
      })
      .startsWith(family),
  ).toBe(true);
  expect(studentKeys.search(params).startsWith(family)).toBe(true);
  expect(
    studentKeys.search({ ...params, groupIds: ["7"] }).startsWith(family),
  ).toBe(false);
  expect(studentKeys.search({ ...params, bus: "yes" }).startsWith(family)).toBe(
    false,
  );
});

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
