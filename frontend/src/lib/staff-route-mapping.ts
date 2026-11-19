// Temporary (#7563): the staff route files answer the contract record of
// /api/staff and, beside it, the flat fields that app bundles built before
// #7563 read (`name`, `firstName`, `tag_id`, …). The current client reads only
// the contract record. Delete this file with the route files after the next
// production deploy; the portal's catalog proxy then answers these paths.
import type {
  ExternalStaffResponse,
  FormerStaffResponse,
  StaffRecordResponse,
} from "~/lib/contract/staff.generated";

/**
 * The contract record with the flat fields older bundles read. The record's
 * own fields come last, so a field the contract names keeps its contract
 * value.
 */
export function withLegacyStaffFields<
  T extends StaffRecordResponse | ExternalStaffResponse,
>(record: T) {
  const person = record.person;
  const firstName = person?.first_name ?? "";
  const lastName = person?.last_name ?? "";
  return {
    name: person ? `${firstName} ${lastName}` : "",
    firstName,
    lastName,
    first_name: firstName,
    last_name: lastName,
    email: person?.email ?? null,
    avatar: person?.avatar ?? null,
    account_id: person?.account_id,
    tag_id: person?.tag_id ?? null,
    staff_id: record.id,
    ...record,
  };
}

/** A former employment with the camel-case fields older bundles read. */
export function withLegacyFormerFields(entry: FormerStaffResponse) {
  return {
    firstName: entry.first_name,
    lastName: entry.last_name,
    startedOn: entry.started_on,
    endedOn: entry.ended_on,
    ...entry,
  };
}
