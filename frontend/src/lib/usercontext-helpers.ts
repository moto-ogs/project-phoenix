// lib/usercontext-helpers.ts

import type { CallerGroupRow } from "./contract/me.generated";
import type * as meContract from "./contract/me.generated";
import type { EducationalGroup } from "./user-context-types";

// Frontend types for UserContext (EducationalGroup is shared with the
// user-context BFF route — single definition in user-context-types.ts)
export type { EducationalGroup };

export interface ActiveGroup {
  id: string;
  room_id?: string;
  room?: {
    id: string;
    name: string;
  };
}

interface Person {
  id: string;
  first_name: string;
  last_name: string;
}

/**
 * The staff record of the signed-in account. The contract sends no phone,
 * mail or emergency contact here; the staff page reads those.
 */
export interface Staff {
  id: string;
  person_id: string;
  person?: Person;
}

/** The answer of `GET /api/me/groups`. */
export type EducationalGroupWire = CallerGroupRow;
/** The answer of `GET /api/me/groups/supervised`. */
export type ActiveGroupWire = meContract.ActiveGroup;
/** The answer of `GET /api/me/staff`. */
export type StaffWire = meContract.Staff;

export interface NavigationEducationalGroup {
  id: string;
  name: string;
  via_substitution?: boolean;
  is_personal?: boolean;
  room_id?: string;
  room_name?: string;
  /** Namen der Gruppenleitung, nur wenn eine zugeordnet ist (#4351). */
  leaders?: string[];
}

// Helper functions to transform backend data to frontend types
export function mapEducationalGroupResponse(
  data: EducationalGroupWire,
): EducationalGroup {
  return {
    id: data.id,
    name: data.name,
    roomId: data.room_id,
    room: data.room ? { id: data.room.id, name: data.room.name } : undefined,
    viaSubstitution: data.via_substitution,
  };
}

export function mapNavigationEducationalGroupResponse(
  data: NavigationEducationalGroup,
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
export function mapActiveGroupResponse(data: ActiveGroupWire): ActiveGroup {
  return {
    id: data.id,
    room_id: data.room_id,
    room: data.room ? { id: data.room.id, name: data.room.name } : undefined,
  };
}

export function mapStaffResponse(data: StaffWire): Staff {
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
