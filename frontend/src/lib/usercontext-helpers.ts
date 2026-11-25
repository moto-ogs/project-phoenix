// lib/usercontext-helpers.ts

import type { ContextNavigationGroup } from "~/lib/contract/active.generated";
import type * as meContract from "./contract/me.generated";
export interface EducationalGroup {
  id: string;
  name: string;
  roomId?: string;
  room?: { id: string; name: string };
  viaSubstitution?: boolean;
}

export interface ActiveGroup {
  id: string;
  room_id?: string;
  room?: {
    id: string;
    name: string;
  };
}

/** The name of the staff member as the navigation shows it. */
type Person = Pick<
  meContract.DirectoryPersonSnapshot,
  "id" | "first_name" | "last_name"
>;

/**
 * The staff record of the signed-in account. The contract sends no phone,
 * mail or emergency contact here; the staff page reads those.
 */
export interface Staff {
  id: string;
  person_id: string;
  person?: Person;
}

export function mapNavigationEducationalGroupResponse(
  data: ContextNavigationGroup,
): EducationalGroup {
  return {
    id: data.id,
    name: data.name,
    roomId: data.room_id,
    room:
      data.room_id && data.room_name
        ? { id: data.room_id, name: data.room_name }
        : undefined,
    viaSubstitution: data.via_substitution ?? false,
  };
}

/**
 * A supervised session. Go sends no name of its own; the view names it by
 * its room.
 */
export function mapActiveGroupResponse(
  data: meContract.ActiveGroup,
): ActiveGroup {
  return {
    id: data.id,
    room_id: data.room_id,
    room: data.room ? { id: data.room.id, name: data.room.name } : undefined,
  };
}

export function mapStaffResponse(data: meContract.Staff): Staff {
  return {
    id: data.id,
    person_id: data.person_id,
    person: data.person
      ? {
          id: data.person.id,
          first_name: data.person.first_name,
          last_name: data.person.last_name,
        }
      : undefined,
  };
}
