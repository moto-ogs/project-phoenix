import type { OfferingChangeRequestBody } from "./contract/parent-me.generated";

/** The form always selects offerings and a date before calling the API. */
export type OfferingChangeInput = Omit<
  OfferingChangeRequestBody,
  "offerings" | "effective_from" | "recipient_guardian_profile_ids"
> & {
  offerings: NonNullable<OfferingChangeRequestBody["offerings"]>;
  effective_from: NonNullable<OfferingChangeRequestBody["effective_from"]>;
};
