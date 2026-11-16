/**
 * OGS-Portal, Verwaltung: Anmeldungen, Datenverwaltung, Rollen, Statistik, Umfragen.
 * Keys describe the response, not its screen; a family prefix ends in `-`.
 */
export const tenantAdminKeys = {
  /** The signed-in person's own e-mail subscription of one type (#3780). */
  emailSubscription: (type: string) =>
    `email-subscription-${encodeURIComponent(type)}`,
  /** One enrollment phase (`getPhase`). */
  enrollmentPhase: (id: string) =>
    `enrollment-phase-detail-${encodeURIComponent(id)}`,
  /** One activity of the Datenverwaltung (`createCrudService(activitiesConfig).getOne`). */
  activity: (id: string) => `activity-detail-${encodeURIComponent(id)}`,
  /** The permission catalog of the Datenverwaltung. */
  permissions: () => "database-permissions-list",
  /**
   * Every role of the school (`createCrudService(rolesConfig).getList`),
   * unfiltered: each reader hides what it does not show.
   */
  roles: () => "database-roles-list",
  /** Every child's masked bank details (`fetchPaymentOverview`). */
  paymentOverview: () => "guardian-payment-overview",
  /** Prefix of every role detail. */
  roleFamily: "role-detail-",
  /** One role with its permissions (`createCrudService(rolesConfig).getOne`). */
  role: (id: string) => `role-detail-${encodeURIComponent(id)}`,
} as const;
