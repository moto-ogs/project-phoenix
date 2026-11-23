// The contract's staff enums for client code. `staff.generated.ts` exports the
// same lists, but beside its decoders: a value import from there pulls zod
// into every page that reads staff. The types still come from the contract,
// so a value the contract adds or drops fails the type check here.
import type {
  ExternalAccountStatus,
  RoleForm,
} from "~/lib/contract/staff.generated";

/** Every value of T, no more and no fewer. */
const everyValueOf =
  <T extends string>() =>
  <const V extends readonly T[]>(
    values: V & ([T] extends [V[number]] ? unknown : never),
  ): V =>
    values;

export const EXTERNAL_ACCOUNT_STATUS_VALUES =
  everyValueOf<ExternalAccountStatus>()([
    "account",
    "invitation_pending",
    "none",
  ]);

export const ROLE_FORM_VALUES = everyValueOf<RoleForm>()([
  "feminine",
  "masculine",
]);
