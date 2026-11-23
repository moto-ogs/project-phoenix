package carecontract

import (
	"context"
	"errors"

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
//   - A contract gets one silent enrollment. While the one made for it has
//     no contract, its row is ready only to bind that application, never
//     to enroll the child again, whatever phase the contract books now.
//   - The binding changes request_child_id and nothing else: no version, no
//     document, no party. It sends nothing. A repeated binding answers the
//     contract as bound.
//   - A contract is bound only to an application child the school's
//     enrollment confirmed under its gates (ApplicationBinding). Every row
//     that is to be bound goes through that enrollment in the school's
//     transaction, also a row whose accepted application the plan proved:
//     the plan proposes, the enrollment confirms, and the binding takes
//     nothing but a confirmation. No other application of the child is
//     ever bound, whatever its state.
//   - No child is booked before its contract: the derived bookings start on
//     the later of the service start of the phase and the first day of the
//     contract.
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
	// application whose own bookings are the contract's already, and the
	// contract is bound to that application once the school's enrollment
	// confirmed it.
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
	// EnrollmentReasonTwoPhases is a contract whose modules of the version in
	// force belong to two enrollment phases: one enrollment has one phase. A
	// planned version in another phase is EnrollmentReasonPlannedChange.
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
	// its phase no booking covers, or no care any more: every module of the
	// version in force has ended. Such a contract whose child has the one
	// accepted application of the phase that booked that care is ready all
	// the same (EnrollmentPlanRow.ProvedOn).
	EnrollmentReasonCareEnds = "care_ends"
	// EnrollmentReasonHasApplication is a child with an accepted
	// application in the phase whose bookings differ from the contract, with
	// several of them, or with one that has another contract. The school's
	// enrollment answers the same for every other application of the child
	// in the phase the plan does not read (ContractEnrollments).
	EnrollmentReasonHasApplication = "has_application"
	// EnrollmentReasonFollowsContract is a child whose accepted application
	// in the phase has the earlier imported contract of the child already
	// (FollowsContractID): this contract follows that one in the same phase,
	// as when one ends on 31 December and the next starts on 1 January. An
	// application child has one contract, so the row stays held; the office
	// handles it as a change of the contract.
	EnrollmentReasonFollowsContract = "follows_contract"
	// EnrollmentReasonOfferingInactive is a contract that promises a module
	// the school deactivated, for a child without an application in the
	// phase: the school's enrollment refuses such a booking with the same
	// reason, because a roster with several sources leaves an inactive one
	// out. A child whose accepted application books the module already is
	// bound all the same: nothing is written for it.
	EnrollmentReasonOfferingInactive = "offering_inactive"
	// EnrollmentReasonPlannedChange is a contract with a version that starts
	// after today, in its phase or in a later one. The silent enrollment writes no dated change of bookings
	// (it would tell the guardians in the parents portal), so the child is
	// enrolled once the planned version holds. A child whose accepted
	// application carries the change already is bound all the same.
	EnrollmentReasonPlannedChange = "planned_change"
)

// What the school's enrollment answered for a ready row, as a binding names
// it. Only these two answers bind.
const (
	// EnrollmentAnswerEnrolled is a child the enrollment enrolled.
	EnrollmentAnswerEnrolled = "enrolled"
	// EnrollmentAnswerExisting is a child the enrollment found and confirmed:
	// the accepted application the row proved, with its stored bookings
	// unchanged since the plan, or the enrollment of this source with the
	// bookings of the row.
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
	// another child record than the one the school's enrollment answered
	// for, another timeline, another application child than
	// the one its row stands for, no longer active, or an application child
	// that has another contract; and a binding without the confirmation of
	// the school's enrollment. It is not bound; the office looks again.
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
	// FollowsContractID is the earlier imported contract that has the
	// application of the child (EnrollmentReasonFollowsContract).
	FollowsContractID ident.ID `json:"follows_contract_id,omitempty"`
	// EnrollmentChildID is, for a ready or a held row, the accepted
	// application of the source contract_import the school made for this
	// contract (Application.ImportContractID) and that has no contract: a
	// run enrolled the child and stopped before the binding. A ready row
	// binds exactly it (RequestChildID is the same application): a contract
	// has one silent enrollment, so a row that would enroll the child anew or
	// bind another application is held instead (has_application). For a row that is held, or that the
	// school's enrollment refuses, the contract can no longer be bound to
	// that enrollment (the service of its phase ended, or its bookings no
	// longer pass the proof): the caller shows such a row as stuck.
	EnrollmentChildID ident.ID `json:"enrollment_child_id,omitempty"`
	// Bookings is what the child books from the first day the contract
	// promises care in the phase: the service start of the phase, or the
	// first day of the contract when that is later. Changes are the planned
	// versions after it, in order.
	Bookings []EnrollmentBooking `json:"bookings"`
	Changes  []EnrollmentChange  `json:"changes"`
	// ApplicationBookings are, for a ready row that names an accepted
	// application (RequestChildID), the bookings of that application as they
	// hold from ProvedOn on, with what the plan read of each module: what
	// the proof stands on. The school's enrollment compares them with the
	// stored bookings under its gates and confirms the application only
	// when nothing changed. ProvedOn is the day of the plan; for a contract
	// that promises no care any more it is the first day the contract
	// promised care in the phase, so the bookings are the whole of what the
	// application booked there.
	ApplicationBookings []EnrollmentBooking `json:"application_bookings,omitempty"`
	ProvedOn            calendar.Date       `json:"proved_on,omitempty"`
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
// The token is that of the ready plan row. One rule says which application
// child a binding may name: the one the school's enrollment
// (enrollment.ContractEnrollments) confirmed for the row under its gates,
// with the status enrolled or existing, which Enrollment carries.
//
// The caller relays the answer of the enrollment, and relates it to its row
// by what the answer names, never by its position in the call: ContractID
// and StudentID are the contract and the child record of
// enrollment.ContractEnrollmentResult, RequestChildID its application child.
// The binding trusts none of it. Under its locks it compares StudentID with
// the child record the contract is linked to and answers any other child
// record, and none, as BindingChanged: an answer for another child never
// binds this contract.
//
//   - A row with RequestChildID names the accepted application the plan
//     proved. The caller hands it to the enrollment with ApplicationBookings
//     and ProvedOn; the enrollment checks that this approved child is the
//     child record's in the phase and that its stored bookings are still
//     the ones the plan proved, and answers existing. The child gets no new
//     enrollment.
//   - A row without one is enrolled, and the enrollment answers enrolled, or
//     existing for the enrollment of this source it finds.
//
// Any other answer of the enrollment (has_application, changed, refused)
// binds nothing, and neither does a binding without an answer. The token of
// the row pins the application child a row with RequestChildID is for, so a
// binding that names another one is answered as BindingChanged.
type ApplicationBinding struct {
	ContractID ident.ID `json:"contract_id"`
	// StudentID is the child record the school's enrollment answered for.
	StudentID      ident.ID `json:"student_id"`
	RequestChildID ident.ID `json:"request_child_id"`
	Token          string   `json:"token"`
	// Enrollment is the answer of the school's enrollment for the row:
	// EnrollmentAnswerEnrolled or EnrollmentAnswerExisting. Without it the
	// binding is BindingChanged.
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
// school's tenant transaction, where it also hands every ready row to the
// school's enrollment (Enrollment), and the binding of the rows that
// enrollment confirmed in a Träger transaction again.
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
	// confirms under its locks, whether the child is to be enrolled or has
	// the accepted application the row names; where both answer, the
	// enrollment's answer goes first (has_application, changed, refused).
	EnrollmentPlans(ctx context.Context, read EnrollmentRead) (EnrollmentPlan, error)
	// BindApplications binds each contract to its application child, in the
	// Träger transaction of the reviewer: under the lock of the Träger's
	// links and the row locks of the contracts it checks again that each is
	// an imported, active, unbound contract of the school with the child
	// record the enrollment answered for and the token of its plan row, and
	// that the binding names the application child the row stands for and
	// carries the confirmation of the school's enrollment
	// (ApplicationBinding), binds it and records it
	// in the trail. It reads nothing of the school: what the enrollment
	// confirmed in the school's transaction may change before this
	// transaction runs, and no transaction holds both (ADR 0105, ADR 0309). A contract that changed is answered as
	// BindingChanged and stays as it is, and so is a second binding of one
	// contract in a call that names another application child; an
	// application child that got a contract past the lock is
	// ErrContractExists.
	BindApplications(ctx context.Context, reviewer Reviewer, schoolID int64, bindings []ApplicationBinding) ([]ApplicationBindingResult, error)
	// UnbindApplication takes the application child off a bound imported
	// contract again, in the Träger transaction of the reviewer and under
	// the lock of the Träger's links: the contract is an imported one linked
	// to its child record, as before the binding, no longer follows the
	// bookings, and its link can be removed and set again (ADR 0307). It
	// writes request_child_id and the trail (unbind) and nothing
	// else: no version, no document, no mail, and nothing at the school,
	// where the enrollment and its bookings stay as they are. It answers
	// the school of the contract. requestChildID is the application child
	// the office saw the contract bound to; a contract that is not bound, or
	// bound to another one, is ErrBindingChanged, a contract that is not an
	// imported one of the Träger ErrContractNotFound.
	UnbindApplication(ctx context.Context, reviewer Reviewer, contractID, requestChildID int64) (schoolID int64, err error)
}

// ErrBindingChanged refuses to take the application child off a contract
// that is not bound to the one the office saw.
var ErrBindingChanged = errors.New("the contract is not bound to this application child")
