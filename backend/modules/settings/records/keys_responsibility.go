package records

// Who is responsible at a school (#4811, ADR 0088): the body that concludes
// the care contracts, the body that bills the parents and the body that
// employs the staff. Each is the Träger (the default), the Schulträger or
// the Gemeinde. The Träger sets a value for all its schools; a school may
// differ (LevelBoth). Name, address and bank details of a Schulträger or a
// Gemeinde are master data of Organisation & Tenancy
// (platform.school_responsible_parties), not settings (ADR 0086 section 1).
const (
	KeyResponsibilityContracts = "responsibility.contracts"
	KeyResponsibilityBilling   = "responsibility.billing"
	KeyResponsibilityStaff     = "responsibility.staff"
)

// The bodies a responsibility names. Organisation & Tenancy reads them as
// its ResponsibleBody.
const (
	ResponsibleBodyTraeger      = "traeger"
	ResponsibleBodySchultraeger = "schultraeger"
	ResponsibleBodyGemeinde     = "gemeinde"
)
