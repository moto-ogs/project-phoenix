package enrollment

import "context"

// Who pays the contribution of a confirmed holiday registration (#8158,
// ADR 0325). The Elternabrechnung decides it and freezes the contribution;
// Enrollment records every change of the decision in the audit trail of the
// registration, so the history names who changed it, why, and what applied
// before.

// HolidayAuditPayer is the entry of the registration's audit trail for a
// change of who pays its contribution after the confirmation.
const HolidayAuditPayer = "payer"

// Kinds of a payer in the audit trail.
const (
	HolidayPayerFamily     = "family"
	HolidayPayerExemption  = "exemption"
	HolidayPayerCostBearer = "cost_bearer"
)

// HolidayPayerReasonMaxLength bounds the reason of a payer change.
const HolidayPayerReasonMaxLength = 500

// HolidayPaidBy is who pays a contribution: the family, nobody (the exemption
// for families receiving benefits) or a cost bearer of the Träger, by a copy
// of its name.
type HolidayPaidBy struct {
	Kind           string `json:"kind"`
	CostBearerName string `json:"cost_bearer_name,omitempty"`
}

// HolidayPayerChange is the payer before and after a change.
type HolidayPayerChange struct {
	Before HolidayPaidBy `json:"before"`
	After  HolidayPaidBy `json:"after"`
}

// HolidayPayerTrail records a payer change of the Elternabrechnung in the
// audit trail of the registration.
type HolidayPayerTrail interface {
	// RecordHolidayPayer records the change with its reason in the
	// reviewer's Träger transaction, under the lock of the period and the
	// registration like every change. Only a confirmed registration takes
	// it; any other state is ErrHolidayRegistrationStateConflict. A blank
	// reason, one over HolidayPayerReasonMaxLength characters or an unknown
	// payer kind is a validation error.
	RecordHolidayPayer(ctx context.Context, reviewer HolidayReviewer, periodID, registrationID int64, change HolidayPayerChange, reason string) error
}
