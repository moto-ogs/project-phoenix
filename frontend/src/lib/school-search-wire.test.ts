import type { SearchResult } from "~/lib/contract/search.generated";
import { describe, expect, it } from "vitest";
import { mapSchoolSearchResult } from "./school-search-wire";

describe("mapSchoolSearchResult", () => {
  it("maps every kind to camelCase", () => {
    const result = mapSchoolSearchResult({
      children: [
        {
          id: "11",
          first_name: "Mia",
          last_name: "Sonnenberg",
          school_class: "3a",
          group_name: "Füchse",
          match: {
            field: "enrollment_answer",
            label: "Seepferdchen",
            text: "Ja",
          },
        },
      ],
      contacts: [
        {
          id: "21",
          first_name: "Sabine",
          last_name: "Sonnenberg",
          match: { field: "phone", text: "+49 170 1234567" },
          children: [
            {
              id: "11",
              first_name: "Mia",
              last_name: "Sonnenberg",
              school_class: "3a",
              relationship_type: "parent",
            },
          ],
        },
      ],
      staff: [{ id: "31", first_name: "Greta", last_name: "Wiesenthal" }],
      rooms: [{ id: "41", name: "Atelier", building: "Altbau" }],
      groups: [{ id: "51", name: "Füchse" }],
      scope: {
        children: true,
        child_details: true,
        contacts: true,
        staff: false,
        rooms: true,
        groups: true,
      },
    });

    expect(result).toEqual({
      children: [
        {
          id: "11",
          firstName: "Mia",
          lastName: "Sonnenberg",
          schoolClass: "3a",
          groupName: "Füchse",
          match: {
            field: "enrollment_answer",
            label: "Seepferdchen",
            text: "Ja",
          },
        },
      ],
      contacts: [
        {
          id: "21",
          firstName: "Sabine",
          lastName: "Sonnenberg",
          match: { field: "phone", text: "+49 170 1234567" },
          children: [
            {
              id: "11",
              firstName: "Mia",
              lastName: "Sonnenberg",
              schoolClass: "3a",
              relationshipType: "parent",
            },
          ],
        },
      ],
      staff: [{ id: "31", firstName: "Greta", lastName: "Wiesenthal" }],
      rooms: [{ id: "41", name: "Atelier", building: "Altbau" }],
      groups: [{ id: "51", name: "Füchse" }],
      scope: {
        children: true,
        childDetails: true,
        contacts: true,
        staff: false,
        rooms: true,
        groups: true,
      },
    });
  });

  it("grants nothing the answer does not state", () => {
    const result = mapSchoolSearchResult({
      children: null,
      contacts: null,
      staff: null,
      rooms: null,
      groups: null,
    } as unknown as SearchResult);
    expect(result.scope).toEqual({
      children: false,
      childDetails: false,
      contacts: false,
      staff: false,
      rooms: false,
      groups: false,
    });
  });
});
