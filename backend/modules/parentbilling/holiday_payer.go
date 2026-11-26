package parentbilling

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Who pays the contribution of a confirmed holiday registration (#8158,
// ADR 0325). A family often brings the notice on its benefits after the
// Träger-Büro confirmed. The office then changes who pays without a
// cancellation and a new registration: the family, nobody (the exemption) or
// a cost bearer. The change freezes a new version of the contribution from
// the base prices the confirmation froze. An invoice that is already issued
// keeps its positions; the office cancels it and the next run bills the new
// version (ADR 0115 addendum #5662, ADR 0119).

// Kinds of a payer.
const (
	HolidayPayerFamily     = "family"
	HolidayPayerExemption  = "exemption"
	HolidayPayerCostBearer = "cost_bearer"
)

// HolidayPayerReasonMaxLength bounds the reason of a payer change.
const HolidayPayerReasonMaxLength = 500

// HolidayPayerChoice is who shall pay: the exemption, an active cost bearer
// of the Träger, or the family when neither is set. Both together are
// ErrCostTakeoverWithExemption.
type HolidayPayerChoice struct {
	BenefitsExemption bool
	CostBearerID      int64
}

// HolidayPayer is who pays a contribution; a cost bearer by its ID and the
// copy of its name the contribution keeps.
type HolidayPayer struct {
	Kind           string    `json:"kind"`
	CostBearerID   *ident.ID `json:"cost_bearer_id"`
	CostBearerName string    `json:"cost_bearer_name"`
}

// HolidayPayerChildEffect is what a payer change does to one child: what the
// family pays and what the cost bearer pays, before and after, in whole
// cent. An exempt child has zero in both.
type HolidayPayerChildEffect struct {
	ChildID               ident.ID `json:"child_id"`
	Position              int      `json:"position"`
	FamilyBeforeCents     int64    `json:"family_before_cents" contract:"number"`
	FamilyAfterCents      int64    `json:"family_after_cents" contract:"number"`
	CostBearerBeforeCents int64    `json:"cost_bearer_before_cents" contract:"number"`
	CostBearerAfterCents  int64    `json:"cost_bearer_after_cents" contract:"number"`
}

// HolidayPayerPreview is what a payer change would freeze, before the
// office saves it: the payer now and the chosen one, the effect per child,
// and whether an issued invoice bills the registration, which then keeps its
// amounts until the office cancels it. ExemptionAvailable reports a valid
// exemption rule. Fingerprint names the frozen contribution and the new one
// (ADR 0311); the change sends it back.
type HolidayPayerPreview struct {
	Current            HolidayPayer              `json:"current"`
	Chosen             HolidayPayer              `json:"chosen"`
	Changed            bool                      `json:"changed"`
	Children           []HolidayPayerChildEffect `json:"children"`
	ExemptionAvailable bool                      `json:"exemption_available"`
	Invoiced           bool                      `json:"invoiced"`
	Fingerprint        string                    `json:"fingerprint"`
}

// HolidayPayerRecord is a payer change as the audit trail of the
// registration keeps it.
type HolidayPayerRecord struct {
	Before HolidayPayer
	After  HolidayPayer
	Reason string
}

// HolidayPayerTrail is Enrollment as a payer change records itself; the
// root binds it. It runs in the caller's Träger transaction.
type HolidayPayerTrail interface {
	// RecordHolidayPayer writes the change into the audit trail of the
	// registration. A registration that is not confirmed is
	// ErrHolidayRegistrationStateConflict; a blank or too long reason is a
	// validation error on reason.
	RecordHolidayPayer(ctx context.Context, reviewer HolidayReviewer, periodID, registrationID int64, record HolidayPayerRecord) error
}

// HolidayPayerChanges changes who pays the contribution of a confirmed
// registration. Both operations run in the Träger transaction of the
// session's Träger, which the caller opens.
type HolidayPayerChanges interface {
	// PreviewHolidayPayer previews the change to choice and stores nothing.
	// A registration that is not confirmed is
	// ErrHolidayRegistrationStateConflict; the refusals of a cost bearer and
	// of the exemption are those of the confirmation.
	PreviewHolidayPayer(ctx context.Context, reviewer HolidayReviewer, periodID, registrationID int64, choice HolidayPayerChoice) (HolidayPayerPreview, error)
	// ChangeHolidayPayer freezes a new version of the contribution with the
	// chosen payer, under the locks of a confirmation, and records the
	// change with reason in the audit trail of the registration. Like a
	// confirmation it computes the sibling group again: another confirmed
	// registration of the group that no issued invoice bills gets a new
	// version when its contribution differs. It
	// refuses a preview other than the one the office read
	// (expectedFingerprint, readstate.ErrChanged). A choice that is the
	// payer already changes and records nothing. The answer is the
	// contribution as HolidayContribution reads it.
	ChangeHolidayPayer(ctx context.Context, reviewer HolidayReviewer, periodID, registrationID int64, choice HolidayPayerChoice, reason, expectedFingerprint string) (HolidayContribution, error)
}
