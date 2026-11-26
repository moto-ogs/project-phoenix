// lib/usercontext-helpers.ts

import type * as meContract from "./contract/me.generated";
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
