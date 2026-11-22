package carecontract

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The enrollment of the children of imported contracts (#7760, ADR 0309). An
// imported contract linked to its child record (ADR 0307) still has no
// enrollment and no bookings, so the daily care does not know the child. This
// capability says, per imported contract of one school, which bookings an
// enrollment made afterwards has to carry, and binds the contract to the
// application child of that enrollment.
//
// Invariants:
//   - The plan derives the bookings from the contract and proves them: a row
//     is ready only when the amendment that follows the bookings
//     (AmendFromBookings) would write no version for exactly these bookings.
//     A difference, such as another end time, holds the row back; it never
//     becomes a silent new version.
//   - A contract with a child record and without an application child is
//     ready, held back or bound; one without a child record is only named.
//   - The binding changes request_child_id and nothing else: no version, no
//     document, no party. It sends nothing. A repeated binding answers the
//     contract as bound.
//   - A contract is bound only to the application child its plan row stands
//     for (ApplicationBinding): the accepted application the row proved, or
//     the enrollment the school made for the row. No other application of
//     the child is ever bound, whatever its state.
//   - The plan reads the accepted applications a contract may come from. The
//     school's enrollment sees more: an application that waits for a
//     decision, or one the office matched to the child record. Its answer
//     is the authoritative one: a ready row whose child it answers as
//     has_application gets no enrollment and no binding, and the caller
//     shows the row as held with that reason.
//   - Only an imported contract is bound here. After the binding it follows
//     its bookings like a contract from an application.
//   - None of the three steps opens a transaction: the caller coordinates
//     the Träger and the school (ADR 0105, ADR 0067) and runs each step in
//     the unit its comment names.

// What the plan says about an imported contract.
const (
	// EnrollmentReady is a contract whose child gets the bookings of the row
	// and that is bound then; with RequestChildID the child has an accepted
	// application whose own bookings are the contract's already and is only
	// bound, to that application.
	EnrollmentReady = "ready"
	// EnrollmentDone is a contract bound to an application child already.
	EnrollmentDone = "done"
	// EnrollmentUnlinked is a contract without a child record: the office
	// links it first (ADR 0307).
	EnrollmentUnlinked = "unlinked"
	// EnrollmentHeld is a contract no enrollment is made for; Reason says
	// why.
	EnrollmentHeld = "held"
)

// Why the plan holds a contract back.
const (
	// EnrollmentReasonContractNotActive is a contract that is not aktiv, or
	// has no effective version: only an active contract follows bookings.
	EnrollmentReasonContractNotActive = "contract_not_active"
	// EnrollmentReasonNotBegun is a contract whose first version starts
	// after today.
	EnrollmentReasonNotBegun = "not_begun"
	// EnrollmentReasonOfferingGone is a module the school no longer has as a
	// care offering, or one without an enrollment phase.
	EnrollmentReasonOfferingGone = "offering_gone"
	// EnrollmentReasonTwoPhases is a contract whose modules belong to two
	// enrollment phases: one enrollment has one phase.
	EnrollmentReasonTwoPhases = "two_phases"
	// EnrollmentReasonPhaseNotBegun and EnrollmentReasonPhaseEnded are a
	// phase whose service has not started, or is over.
	EnrollmentReasonPhaseNotBegun = "phase_not_begun"
	EnrollmentReasonPhaseEnded    = "phase_ended"
	// EnrollmentReasonFixedDays is a module with fixed weekdays the contract
	// promises on other weekdays than these.
	EnrollmentReasonFixedDays = "fixed_days"
	// EnrollmentReasonDayUnavailable is a weekday the module does not offer.
	EnrollmentReasonDayUnavailable = "day_unavailable"
	// EnrollmentReasonEndTime is a contract whose end time of a weekday is
	// not the module's: the bookings would make a new version with the
	// module's end time. An offering correction that kept the old end time
	// is such a contract.
	EnrollmentReasonEndTime = "end_time"
	// EnrollmentReasonBookingsDiffer is any other difference between the
	// contract and the bookings that would make a new version.
	EnrollmentReasonBookingsDiffer = "bookings_differ"
	// EnrollmentReasonCareEnds is a contract that promises care on a day in
	// its phase no booking covers.
	EnrollmentReasonCareEnds = "care_ends"
	// EnrollmentReasonHasApplication is a child with an accepted
	// application in the phase whose bookings differ from the contract, with
	// several of them, or with one that has another contract. The school's
	// enrollment answers the same for every other application of the child
	// in the phase the plan does not read (ContractEnrollments).
	EnrollmentReasonHasApplication = "has_application"
	// EnrollmentReasonPlannedChange is a contract with a version that starts
	// after today. The silent enrollment writes no dated change of bookings
	// (it would tell the guardians in the parents portal), so the child is
	// enrolled once the planned version holds. A child whose accepted
	// application carries the change already is bound all the same.
	EnrollmentReasonPlannedChange = "planned_change"
)

// What the school's enrollment answered for a ready row without an
// application child, as a binding names it.
const (
	// EnrollmentAnswerEnrolled is a child the enrollment enrolled.
	EnrollmentAnswerEnrolled = "enrolled"
	// EnrollmentAnswerExisting is a child that had the enrollment of this
	// source with the bookings of the row already.
	EnrollmentAnswerExisting = "existing"
)

// What a binding did with a contract.
const (
	// BindingBound is a contract the call bound.
	BindingBound = "bound"
	// BindingDone is a contract bound to the named application child
	// already: a repeated call changes nothing.
	BindingDone = "done"
	// BindingChanged is a contract that is no longer what the plan saw:
	// another child record, another timeline, another application child than
	// the one its row stands for, no longer active, or an application child
	// that has another contract. It is not bound; the office looks again.
	BindingChanged = "changed"
)

// EnrollmentContract is an imported contract of a school as the plan reads
// it in the Träger transaction: its status, its child record and application
// child, the last day of a termination, the child as its newest version
// names it, and its effective versions by effective date. It carries the
// read from the Träger transaction into the school's.
type EnrollmentContract struct {
	ID             int64
	SchoolID       int64
	Status         string
	StudentID      *int64
	RequestChildID *int64
	EndsOn         *calendar.Date
	FirstFrom      calendar.Date
	NextNumber     int
	ChildFirstName string
	ChildLastName  string
	Versions       []Version
}

// EnrollmentRead is what the plan reads in the Träger transaction: the
// imported contracts of the school, and the application children of the
// school that have a contract.
type EnrollmentRead struct {
	SchoolID  int64
	Contracts []EnrollmentContract
	// ContractedChildren are the application children with a contract at the
	// school: such a child is never bound to a second one.
	ContractedChildren []int64
}

// EnrollmentBooking is one booking an enrollment carries: the module, its
// weekdays and the half-open time it holds, ValidUntil exclusive.
//
// EndTimes, AvailableDays and DaysOfWeekMode are what the plan read of the
// module and proved the booking on: its end time on each booked weekday, the
// weekdays it offers and whether they are fixed. The school's enrollment
// compares them with the module under its locks and enrolls no child whose
// module changed since.
type EnrollmentBooking struct {
	CareOfferingID ident.ID          `json:"care_offering_id"`
	ModuleName     string            `json:"module_name"`
	Days           []string          `json:"days"`
	ValidFrom      calendar.Date     `json:"valid_from"`
	ValidUntil     calendar.Date     `json:"valid_until"`
	EndTimes       map[string]string `json:"end_times"`
	AvailableDays  []string          `json:"available_days"`
	DaysOfWeekMode string            `json:"days_of_week_mode"`
}

// EnrollmentChange is a planned version of the contract: from EffectiveFrom
// on the child books Bookings instead.
type EnrollmentChange struct {
	EffectiveFrom calendar.Date       `json:"effective_from"`
	Bookings      []EnrollmentBooking `json:"bookings"`
}

// EnrollmentPlanRow is one imported contract of the school with what the
// plan says about it.
type EnrollmentPlanRow struct {
	ContractID ident.ID `json:"contract_id"`
	Status     string   `json:"status"`
	// Reason is why a held row is held back.
	Reason         string   `json:"reason,omitempty"`
	StudentID      ident.ID `json:"student_id,omitempty"`
	ChildFirstName string   `json:"child_first_name"`
	ChildLastName  string   `json:"child_last_name"`
	// PhaseID and PhaseName are the enrollment phase of the modules; empty
	// while the modules name none. PhaseStart and PhaseEnd are the first and
	// the last day of its service as the plan read them: the school's
	// enrollment enrolls no child whose phase moved since.
	PhaseID    ident.ID      `json:"phase_id,omitempty"`
	PhaseName  string        `json:"phase_name"`
	PhaseStart calendar.Date `json:"phase_start,omitempty"`
	PhaseEnd   calendar.Date `json:"phase_end,omitempty"`
	// RequestChildID is the application child the contract is bound to
	// (done), the accepted application a ready row is bound to without a new
	// enrollment, or the application that holds the row back.
	RequestChildID ident.ID `json:"request_child_id,omitempty"`
	// Bookings is what the child books from the service start of the phase;
	// Changes are the planned versions after it, in order.
	Bookings []EnrollmentBooking `json:"bookings"`
	Changes  []EnrollmentChange  `json:"changes"`
	// Token names what a ready row was proved on: the effective versions of
	// the contract, and the application child the binding is for
	// (RequestChildID), or that the row has none and the school enrolls the
	// child. The binding takes a contract only with the token of its row.
	Token string `json:"token,omitempty"`
}

// EnrollmentCounts counts the rows per status.
type EnrollmentCounts struct {
	Ready    int `json:"ready"`
	Done     int `json:"done"`
	Unlinked int `json:"unlinked"`
	Held     int `json:"held"`
}

// EnrollmentPlan is the answer of the plan for one school: every imported
// contract, by contract.
type EnrollmentPlan struct {
	SchoolID ident.ID            `json:"school_id"`
	Counts   EnrollmentCounts    `json:"counts"`
	Rows     []EnrollmentPlanRow `json:"rows"`
}

// ApplicationBinding binds one imported contract to an application child.
// The child record and the token are those of the ready plan row. One rule
// says which application child a binding may name:
//
//   - A row with RequestChildID is bound to exactly that application child,
//     the accepted application the plan proved. The child is not enrolled.
//   - A row without one is bound to the application child the school's
//     enrollment (enrollment.ContractEnrollments) answered for the contract
//     with the status enrolled or existing, and Enrollment carries that
//     status. Any other answer of the enrollment (has_application, changed,
//     refused) binds nothing.
//
// The token of the row carries which of the two holds, so a binding that
// names another application child is answered as BindingChanged.
type ApplicationBinding struct {
	ContractID     ident.ID `json:"contract_id"`
	StudentID      ident.ID `json:"student_id"`
	RequestChildID ident.ID `json:"request_child_id"`
	Token          string   `json:"token"`
	// Enrollment is EnrollmentAnswerEnrolled or EnrollmentAnswerExisting for
	// a row without an application child, empty for a row that names one.
	Enrollment string `json:"enrollment,omitempty"`
}

// ApplicationBindingResult is what the binding did with one contract:
// BindingBound, BindingDone or BindingChanged.
type ApplicationBindingResult struct {
	ContractID ident.ID `json:"contract_id"`
	Status     string   `json:"status"`
}

// ContractEnrollments plans the enrollment of the children of the imported
// contracts of one school and binds the contracts to it. It opens no
// transaction. The caller runs the steps one after the other, each in its
// own unit (ADR 0105): the read in the Träger transaction, the plan in the
// school's tenant transaction, where it also enrolls the ready children
// (Enrollment), and the binding in a Träger transaction again.
type ContractEnrollments interface {
	// EnrollmentContracts reads, in the Träger transaction of the reviewer,
	// the imported contracts of the school with their timelines and records
	// the read in the trail. A school of another Träger answers no contract.
	EnrollmentContracts(ctx context.Context, reviewer Reviewer, schoolID int64) (EnrollmentRead, error)
	// EnrollmentPlans answers every contract of the read, in the tenant
	// transaction of the read's school: it reads the school's care
	// offerings with their phases and the accepted applications of the
	// linked children with their bookings, derives the bookings of each
	// contract and proves them against the amendment. It writes nothing. A
	// read of another school than the one whose tenant transaction the
	// caller holds is ErrSchoolOutsideTraeger. The plan shows child records
	// and applications of the school to the Träger-Büro: the caller writes
	// the read into the access log of the school (ADR 0084 section 7) in
	// the same tenant transaction.
	//
	// The plan reads only the accepted applications a contract may come
	// from. A ready row is therefore a proposal the school's enrollment
	// confirms under its locks; where both answer, the enrollment's answer
	// goes first (has_application, changed, refused).
	EnrollmentPlans(ctx context.Context, read EnrollmentRead) (EnrollmentPlan, error)
	// BindApplications binds each contract to its application child, in the
	// Träger transaction of the reviewer: under the lock of the Träger's
	// links and the row locks of the contracts it checks again that each is
	// an imported, active, unbound contract of the school with the child
	// record and the token of its plan row, and that the binding names the
	// application child the row stands for (ApplicationBinding), binds it
	// and records it in the trail. A contract that changed is answered as
	// BindingChanged and stays as it is, and so is a second binding of one
	// contract in a call that names another application child; an
	// application child that got a contract past the lock is
	// ErrContractExists.
	BindApplications(ctx context.Context, reviewer Reviewer, schoolID int64, bindings []ApplicationBinding) ([]ApplicationBindingResult, error)
}
