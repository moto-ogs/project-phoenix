package records

// The Träger values of the Einsatzplanung (#4708, ADR 0089 section 8). Only
// the Träger sets them (LevelTraeger), with the right „Personal“; every
// school of the Träger reads them.
//
//   - KeyStaffPlanningEnabled: „Einsatzplanung in moto“. Off, neither the
//     Träger nor its schools plan new shifts, for a Träger that plans in its
//     own system. Planned shifts stay readable.
//   - KeyStaffPlanningMaxDailyHours: more planned work on one day than this
//     warns (§ 3 ArbZG). 0 switches the check off.
//   - KeyStaffPlanningMinRestHours: less rest between two working days than
//     this warns (§ 5 ArbZG): "11" by default, "10" where the Träger shortens
//     the rest and gives the compensation.
//   - KeyStaffPlanningCheckBreaks: a day with too little break warns (§ 4
//     ArbZG).
const (
	KeyStaffPlanningEnabled       = "staff_planning.enabled"
	KeyStaffPlanningMaxDailyHours = "staff_planning.max_daily_hours"
	KeyStaffPlanningMinRestHours  = "staff_planning.min_rest_hours"
	KeyStaffPlanningCheckBreaks   = "staff_planning.check_breaks"
)
