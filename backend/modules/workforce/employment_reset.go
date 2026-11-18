package workforce

import "context"

// EmploymentReset is the accepted invitation's instruction. ActorAccountID
// accepts it; the invitation note identifies the school's prior decision.
type EmploymentReset struct {
	PreviousPersonnelNumber *string
	StaffID                 int64
	ActorAccountID          int64
	InvitationID            int64
	MasterData              bool
	Qualifications          bool
	WorkTime                bool
}

// InvitedGender is the Stammdaten gender a school entered on the accepted
// invitation; InvitationID names the source in the audit note.
type InvitedGender struct {
	StaffID      int64
	InvitationID int64
	Gender       string
}

type EmploymentResetter interface {
	PrepareEmploymentReset(context.Context, EmploymentReset) (*string, error)
	ResetEmployment(context.Context, EmploymentReset) error
	// ApplyInvitedGender sets the gender through the audited person
	// section and leaves names and birthday as they are.
	ApplyInvitedGender(context.Context, InvitedGender) error
}
