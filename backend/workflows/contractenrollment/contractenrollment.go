// Package contractenrollment is the workflow that gives the children of
// imported care contracts their enrollment afterwards and binds each
// contract to it (#7760, ADR 0309 section 4). It owns no data: Care
// Contract keeps the contracts, plans the bookings and binds, Enrollment
// keeps the enrollment of the school. The workflow holds the order of the
// transactions, the merge of both answers, the fingerprint of the preview
// and the entry in the access log of the school.
//
// Invariants:
//   - One call concerns one school of the Träger and opens its transactions
//     itself, one after the other and never nested (ADR 0105): the Träger
//     transaction for the contracts, the tenant transaction of the school
//     for the plan and the enrollment, the Träger transaction for the
//     binding. The caller holds no transaction.
//   - The school is one of the Träger for as long as its tenant transaction
//     runs: the workflow holds it there under a share lock before it reads
//     or writes anything of the school (carecontract.ErrSchoolOutsideTraeger
//     otherwise). Between that transaction and the binding no lock holds.
//   - Every read of the school writes the access log of the school in the
//     same tenant transaction (ADR 0084 section 7), the preview included.
//   - The run takes only the preview the office confirmed: it plans again
//     in the school's transaction and writes nothing of the school when the
//     rows are no longer the previewed ones (ErrPreviewChanged). It enrolls
//     only the rows that preview showed as ready; a row it showed as held
//     is not handed to the school's enrollment.
//   - A contract is bound only on the answer of the school's enrollment for
//     its row (enrolled or existing), related to the row by contract and
//     child record, never by its position in the call.
//   - It is silent: no step sends a mail, a push or an invitation.
//   - A run that stopped before the binding is finished by the next one:
//     the child is found enrolled and the contract is bound. Nothing is
//     written twice.
package contractenrollment

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ErrPreviewChanged rejects a run whose preview no longer matches the
// contracts or the school.
var ErrPreviewChanged = errors.New("the preview no longer matches the contracts of the school")

// Actor is the Träger office of the session.
type Actor struct {
	OrganizationID int64
	AccountID      int64
}

// What a row says about an imported contract.
const (
	// RowReady is a contract the run handles: Action says how.
	RowReady = "ready"
	// RowDone is a contract bound to the enrollment of its child. After a
	// run, Action says what the run did for it; empty when it was bound
	// before.
	RowDone = "done"
	// RowUnlinked is a contract without a child record: the office links it
	// first (ADR 0307).
	RowUnlinked = "unlinked"
	// RowHeld is a contract nothing is written for; Reason says why, with
	// the reason of the plan (carecontract.EnrollmentReason...) or of the
	// school's enrollment (enrollment.ContractEnrollment...).
	RowHeld = "held"
	// RowStuck is a held contract whose child has the silent enrollment of
	// an earlier run that stopped before the binding (RequestChildID), and
	// the contract can no longer be bound to it; Reason says why. The office
	// corrects the contract or the bookings of that enrollment, or the
	// school ends the care of the child (ADR 0309).
	RowStuck = "stuck"
	// RowChanged is a contract whose school or timeline is no longer what
	// the plan read: the school's enrollment or the binding refused it.
	// Nothing was bound; the office previews again. A child the run enrolled
	// before the binding refused keeps its enrollment (RequestChildID), and
	// the next run binds it.
	RowChanged = "changed"
)

// What a ready row does, and what a run did for a done row.
const (
	// ActionEnroll enrolls the child with the bookings of the row and binds
	// the contract to that enrollment.
	ActionEnroll = "enroll"
	// ActionBind binds the contract to the application the child has
	// already (RequestChildID): its own bookings are the contract's.
	ActionBind = "bind"
)

// ReasonChanged is the reason of a held preview row whose application is no
// longer what the plan proved.
const ReasonChanged = "changed"

// ContractChildName is the child as the newest version of the contract names it.
type ContractChildName struct {
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

// ChildRecord is the child record the contract is linked to, as the school
// has it. The office compares it with the child of the contract before
// anything runs: a wrong link (ADR 0307) shows here.
type ChildRecord struct {
	StudentID ident.ID       `json:"student_id"`
	FirstName string         `json:"first_name"`
	LastName  string         `json:"last_name"`
	BirthDate *calendar.Date `json:"birth_date,omitempty"`
}

// EnrollmentRow is one imported contract of the school.
type EnrollmentRow struct {
	ContractID ident.ID `json:"contract_id"`
	SchoolID   ident.ID `json:"school_id"`
	Status     string   `json:"status"`
	Reason     string   `json:"reason,omitempty"`
	Action     string   `json:"action,omitempty"`
	// ContractChild and Student are the child on both sides; Student is nil
	// for a contract without a child record, and for a child record the
	// school no longer has.
	ContractChild ContractChildName `json:"contract_child"`
	Student       *ChildRecord      `json:"student,omitempty"`
	PhaseID       ident.ID          `json:"phase_id,omitempty"`
	PhaseName     string            `json:"phase_name"`
	// Bookings are the modules the child books with their weekdays and the
	// half-open time each holds (ValidUntil exclusive). For a ready row with
	// ActionEnroll they are what the run writes: the bookings derived from
	// the contract. For a ready row that binds the application the plan
	// proved (ActionBind with the RequestChildID of the plan) they are the
	// stored bookings of that application as they hold from the day of the
	// plan on, the ones the contract follows after the binding; nothing is
	// written for them. For every other row they are the bookings derived
	// from the contract, empty when none can be derived. Changes are the
	// planned versions of the contract after the derived bookings; a row
	// that shows the bookings of an application has none, those bookings
	// carry the change.
	Bookings []carecontract.EnrollmentBooking `json:"bookings"`
	Changes  []carecontract.EnrollmentChange  `json:"changes"`
	// RequestChildID is the application child the contract is bound to or
	// would be bound to, the application that holds the row back, or the
	// silent enrollment of a stuck row.
	RequestChildID ident.ID `json:"request_child_id,omitempty"`
	// FollowsContractID is the earlier imported contract of the child that
	// has its application (reason follows_contract).
	FollowsContractID ident.ID `json:"follows_contract_id,omitempty"`
}

// EnrollmentRowCounts counts the rows per status.
type EnrollmentRowCounts struct {
	Ready    int `json:"ready"`
	Done     int `json:"done"`
	Unlinked int `json:"unlinked"`
	Held     int `json:"held"`
	Stuck    int `json:"stuck"`
	Changed  int `json:"changed"`
}

// EnrollmentPreview is what a run would do at one school, with its fingerprint.
type EnrollmentPreview struct {
	SchoolID    ident.ID            `json:"school_id"`
	Fingerprint string              `json:"fingerprint"`
	Counts      EnrollmentRowCounts `json:"counts"`
	Rows        []EnrollmentRow     `json:"rows"`
}

// EnrollmentRun is what a run did at one school, per contract.
type EnrollmentRun struct {
	SchoolID ident.ID `json:"school_id"`
	// Changed tells that the run committed something: the school's
	// enrollment enrolled at least one child, or at least one contract was
	// bound. A run that found every row done or held changed nothing. It
	// stands before Rows: the usage analytics reads it from the start of
	// the answer (contract_children_enrolled).
	Changed bool                `json:"changed"`
	Counts  EnrollmentRowCounts `json:"counts"`
	Rows    []EnrollmentRow     `json:"rows"`
}

// Enrollments previews and runs the enrollment of the children of the
// imported contracts of one school, and takes a binding off again.
type Enrollments interface {
	// Preview answers every imported contract of the school with what a run
	// would do. It writes the access log of the school and the trail of the
	// Träger and nothing else. A school of another Träger is
	// carecontract.ErrSchoolOutsideTraeger.
	Preview(ctx context.Context, actor Actor, schoolID int64) (EnrollmentPreview, error)
	// Run enrolls and binds the rows the preview with the fingerprint showed
	// as ready, or answers ErrPreviewChanged. A refused run has enrolled and
	// bound nothing and left no entry in the access log of the school (it
	// rolls back with the school's transaction); the entry of its read of
	// the contracts in the trail of the Träger stays, as after a preview.
	Run(ctx context.Context, actor Actor, schoolID int64, fingerprint string) (EnrollmentRun, error)
	// Unbind takes the application child the office saw off a bound
	// imported contract, in a Träger transaction
	// (carecontract.ContractEnrollments.UnbindApplication). The enrollment
	// of the child stays at the school as it is.
	Unbind(ctx context.Context, actor Actor, contractID, requestChildID int64) error
}
