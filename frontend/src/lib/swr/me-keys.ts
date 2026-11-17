import { SWR_FAMILIES } from "./shell-keys";
export const meKeys = {
  family: SWR_FAMILIES.me,
  key: () => "me-staff",
} as const;

// The signed-in staff member's own profile (/api/me/profile). Outside the
// `me-` family: group-access events refresh that family, not the profile.
export const profileKeys = {
  own: () => "profile-own",
} as const;
