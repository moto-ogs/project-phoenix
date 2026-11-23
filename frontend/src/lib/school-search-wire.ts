import type {
  SearchMatch,
  SearchResult,
} from "~/lib/contract/search.generated";
import type {
  SchoolSearchMatch,
  SchoolSearchMatchField,
  SchoolSearchResult,
} from "~/lib/school-search-types";

function mapMatch(match: SearchMatch): SchoolSearchMatch {
  return {
    field: match.field as SchoolSearchMatchField,
    ...(match.label ? { label: match.label } : {}),
    ...(match.text ? { text: match.text } : {}),
  };
}

/** Maps the backend answer onto the frontend shape. */
export function mapSchoolSearchResult(
  result: SearchResult,
): SchoolSearchResult {
  return {
    children: (result.children ?? []).map((child) => ({
      id: child.id,
      firstName: child.first_name,
      lastName: child.last_name,
      schoolClass: child.school_class,
      ...(child.group_name ? { groupName: child.group_name } : {}),
      match: mapMatch(child.match),
    })),
    contacts: (result.contacts ?? []).map((contact) => ({
      id: contact.id,
      firstName: contact.first_name,
      lastName: contact.last_name,
      match: mapMatch(contact.match),
      children: (contact.children ?? []).map((child) => ({
        id: child.id,
        firstName: child.first_name,
        lastName: child.last_name,
        schoolClass: child.school_class,
        relationshipType: child.relationship_type,
      })),
    })),
    staff: (result.staff ?? []).map((member) => ({
      id: member.id,
      firstName: member.first_name,
      lastName: member.last_name,
    })),
    rooms: (result.rooms ?? []).map((room) => ({
      id: room.id,
      name: room.name,
      ...(room.building ? { building: room.building } : {}),
    })),
    groups: (result.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
    })),
    // A missing answer field grants nothing.
    scope: {
      children: result.scope?.children === true,
      childDetails: result.scope?.child_details === true,
      contacts: result.scope?.contacts === true,
      staff: result.scope?.staff === true,
      rooms: result.scope?.rooms === true,
      groups: result.scope?.groups === true,
    },
  };
}
