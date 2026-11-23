package enrollment

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The enrollment of a child whose care contract the Träger took over from a
// file (#7760, ADR 0309). Such a child is in the school's child records and
// has a contract, but no enrollment: the daily care reads approved bookings,
// and it has none. This capability makes the enrollment afterwards, for an
// existing child record and with the bookings the contract stands for.
//
// Invariants:
//   - It is silent. It sends no mail, no push and no invitation, gives no
//     account access to the school, and changes neither the child record
//     nor a guardian, a relationship, a consent or a weekly plan. The
//     request names no guardian and no address, so no parent finds it in
//     the parents portal. What follows from the bookings is derived as
//     after every approval: a coming pickup exception keeps its day, time
//     and reason, and its automatic excusal and the staff task of the day
//     follow the booked end time.
//   - It writes one request with one approved child per contract, linked to
//     the child record that exists, with the bookings given and the rosters
//     an approval derives from them.
//   - A repeated call writes nothing twice: a child that has the enrollment
//     of this source in the phase is answered with it. What only a new
//     enrollment is refused for does not refuse it: an enrollment stored as
//     asked for is answered as existing also when the school has since
//     deactivated its offering or linked it to a roster directly, so a run
//     that stopped before the binding can still bind its contract.
//   - A contract has one silent enrollment, whatever its phase. A child
//     that has the enrollment of this source made for the contract of the
//     row in another phase gets none here (enrolled_elsewhere); the answer
//     names that enrollment. The run reads it under the approval gates,
//     which serialize the runs of one school across its phases, so a run
//     that waited for another finds what that one wrote.
//   - A child with any other application in the phase gets none; the answer
//     names that application. Any other means every request child of the
//     phase that holds the child record and is neither rejected nor
//     withdrawn: one that waits for a decision, one the office matched to
//     the child record, an approved one. This answer is the authoritative
//     one. The plan of the Träger (carecontract.ContractEnrollments) reads
//     only accepted applications a contract may come from, so a row it
//     calls ready may be answered has_application here; no contract is
//     bound to such an application.
//   - What the plan read of the school is compared again under the locks:
//     the service of the phase and, per booking, the end times, the
//     weekdays and the weekday mode of the offering, and that the offering
//     still counts as care. A child whose phase or offering changed since
//     the plan is answered as changed and gets no enrollment.
//   - It creates what the office confirmed of the child record. The request
//     child of a new enrollment stores the name and the date of birth of
//     the child record. A row carries them as the confirmed preview showed
//     them (ContractEnrollment.Confirmed), and the capability compares them
//     with the child record it reads under its gates: a child record whose
//     name or date of birth changed since is answered as changed, and
//     nothing is written for it.
//   - It also confirms what the plan proved of an application that exists.
//     A row that names an approved application child (RequestChildID) is
//     never enrolled: under the same locks the capability checks that this
//     child is the only one of the phase that holds the child record and
//     that its stored bookings are still the ones the plan proved, and
//     answers existing, else changed or has_application. A contract is
//     bound only to an application child this capability answered as
//     enrolled or existing. The confirmation compares the application, its
//     phase and its offerings only. It does not repeat what a new
//     enrollment is refused for (the care end and the OGS place of the
//     child record, the rosters of the offerings, the length of the
//     window): the school approved that application itself, and nothing is
//     written for it. One thing about the child record does refuse it: a
//     child record that is gone or no longer active (student_missing,
//     student_inactive). A confirmation leads to the binding of the
//     contract, and no contract is bound to the enrollment of a child that
//     left the school. The same holds for the stored enrollment of this
//     source a repeated call finds.
//   - No child is booked before its contract: the bookings of a child start
//     on one day, the service start of the phase or a later day within it,
//     and its rosters start on that day. That day is never after today: the
//     plan books a contract and a phase that began, and a row that starts
//     later is refused (booking_window). An undated correction of the
//     office reads the bookings on today's day, so it finds them.
//   - It writes no care past the child record's care end. A child whose
//     recorded care end lies before the end of its bookings is refused
//     (care_ends_earlier). So is a booking whose window holds none of one
//     of its weekdays (window_too_short), which Care Plan's roster check
//     would answer with an error for the whole call. A booking that ends
//     before the service of the phase is enrolled, and its roster row ends
//     with it, whether its offering names the roster through the direct
//     link (ActivityGroupID) or a roster names it as its source (#7908).
//     Refused too is a booking of an offering the school deactivated
//     (offering_inactive): a roster with several sources leaves an inactive
//     one out, and the child would be approved on no roster.
//   - A school that derives no care from bookings
//     (enrollment.care_offerings_enabled off) gets no enrollment: every row
//     is refused before anything is read, locked or written.
//   - A row that cannot be enrolled is refused with its reason and writes
//     nothing; the other rows go on.
//   - The statements of the capability itself do not grow with the number
//     of children: it reads and writes its rows in sets. The care a child's
//     bookings derive (the bookings, the rosters and the multi-source
//     rosters) is written by Care Plan's building blocks of an approval,
//     one child at a time, and so is the resync of its pickup auto
//     excusals (ADR 0309).

// What the enrollment did with a child.
const (
	// ContractEnrollmentEnrolled is a child the call enrolled; a check
	// answers it for a child the call would enroll.
	ContractEnrollmentEnrolled = "enrolled"
	// ContractEnrollmentExisting is a child that has the enrollment of this
	// source in the phase already, with the bookings given; and the
	// application a row names (ContractEnrollment.RequestChildID) that is
	// the child record's approved application of the phase with the stored
	// bookings the plan proved.
	ContractEnrollmentExisting = "existing"
	// ContractEnrollmentHasApplication is a child with another application
	// in the phase; RequestID names it, RequestChildID its child. A contract
	// is never bound to it.
	ContractEnrollmentHasApplication = "has_application"
	// ContractEnrollmentChanged is a child whose phase or offering is no
	// longer what the plan read: the service of the phase moved, or an
	// offering has other end times, weekdays or another weekday mode, or no
	// longer counts as care. It is also a child record whose name or date of
	// birth is no longer what the row carries as confirmed
	// (ContractEnrollment.Confirmed). For a row that names an application it is also
	// an application that is gone, no longer approved or matched by the
	// office, or whose stored bookings are not the ones the plan proved, as
	// when the office changed its weekdays after the plan. It writes
	// nothing; the caller plans again.
	ContractEnrollmentChanged = "changed"
	// ContractEnrollmentRefused is a child that is not enrolled; Reason
	// says why.
	ContractEnrollmentRefused = "refused"
)

// Why a child is refused.
const (
	// ContractEnrollmentStudentMissing is a child record the school does
	// not have.
	ContractEnrollmentStudentMissing = "student_missing"
	// ContractEnrollmentStudentInactive is a child record that is not
	// active.
	ContractEnrollmentStudentInactive = "student_inactive"
	// ContractEnrollmentWithoutCarePlace is a child without an OGS place:
	// an enrollment would grant one.
	ContractEnrollmentWithoutCarePlace = "without_care_place"
	// ContractEnrollmentBirthDateMissing is a child record without a date
	// of birth, which a request child needs.
	ContractEnrollmentBirthDateMissing = "birth_date_missing"
	// ContractEnrollmentPhaseMissing is a phase the school does not have.
	ContractEnrollmentPhaseMissing = "phase_missing"
	// ContractEnrollmentOfferingPhase is an offering that is not one of the
	// phase, or a child without a booking.
	ContractEnrollmentOfferingPhase = "offering_phase"
	// ContractEnrollmentDayUnavailable is a weekday the offering does not
	// offer, or a subset of the weekdays of an offering with fixed days.
	ContractEnrollmentDayUnavailable = "day_unavailable"
	// ContractEnrollmentBookingWindow is a booking that starts before the
	// service of the phase, after today or on another day than the other
	// bookings of the child, does not end within the service, or names an
	// offering twice.
	ContractEnrollmentBookingWindow = "booking_window"
	// ContractEnrollmentCareOfferingsOff is a school that derives no care
	// from bookings (enrollment.care_offerings_enabled off): an approval
	// there writes no roster, so no child is enrolled.
	ContractEnrollmentCareOfferingsOff = "care_offerings_off"
	// ContractEnrollmentCareEndsEarlier is a child record whose recorded
	// care end (its last care day) lies before the last day of the bookings:
	// the bookings would promise care the child record has ended.
	ContractEnrollmentCareEndsEarlier = "care_ends_earlier"
	// ContractEnrollmentWindowTooShort is a booking whose window holds no
	// day of one of its weekdays, as a Monday booking from Thursday 30 July
	// to the end of the service on Friday 31 July: there is no day of care
	// to derive, and no roster to write.
	ContractEnrollmentWindowTooShort = "window_too_short"
	// ContractEnrollmentOfferingInactive is a child with a booking of an
	// offering the school deactivated. A roster that names several offerings
	// as its sources leaves an inactive one out, so the child would be
	// approved and on no roster. An enrollment that is stored already is
	// answered as existing all the same: nothing is written for it.
	ContractEnrollmentOfferingInactive = "offering_inactive"
	// ContractEnrollmentPlannedChange is a contract with a planned version.
	// A dated change of the bookings of an approved child tells the child's
	// guardians in the parents portal (Care Plan's offering adjustment), so
	// the silent enrollment writes none: the child is enrolled once the
	// planned version holds.
	ContractEnrollmentPlannedChange = "planned_change"
	// ContractEnrollmentBookingsDiffer is a child that has the enrollment of
	// this source with other bookings than the ones given. The enrollment
	// corrects no approved bookings: the rosters of an approved child are
	// not derived twice. The office changes the bookings on the usual way.
	ContractEnrollmentBookingsDiffer = "bookings_differ"
	// ContractEnrollmentEnrolledElsewhere is a child that has the silent
	// enrollment made for this contract in another phase: a contract has one
	// silent enrollment (ADR 0309), so neither a new one is made nor another
	// application confirmed for it. An earlier run enrolled the child there,
	// and the office has since corrected the unbound contract to an offering
	// of this phase. RequestID and RequestChildID name that enrollment. The
	// office corrects the contract back; ending that enrollment at the school
	// does not release the contract (ADR 0309).
	ContractEnrollmentEnrolledElsewhere = "enrolled_elsewhere"
)

// ContractBooking is one booking of an offering: its weekdays and the
// half-open time it holds, ValidUntil exclusive. EndTimes, AvailableDays and
// DaysOfWeekMode are what the plan read of the offering: its end time on
// each booked weekday ("mon" to "HH:MM", empty without one), the weekdays it
// offers and whether they are fixed.
type ContractBooking struct {
	CareOfferingID int64
	Days           []string
	ValidFrom      calendar.Date
	ValidUntil     calendar.Date
	EndTimes       map[string]string
	AvailableDays  []string
	DaysOfWeekMode string
}

// ContractBookingChange is a planned change of the bookings from
// EffectiveFrom on.
type ContractBookingChange struct {
	EffectiveFrom calendar.Date
	Bookings      []ContractBooking
}

// ContractEnrollment asks for the enrollment of one child record in a phase:
// the bookings that hold from the first day the contract promises care in
// the phase, the planned changes after it, the contract they come from and
// the account that acts. ServiceStart and ServiceEnd are the first and the
// last day of the service of the phase as the plan read them. The first day
// of the bookings is never after today (ContractEnrollmentBookingWindow).
//
// With RequestChildID the row asks for no enrollment but for the
// confirmation of the approved application the plan proved: Bookings are
// then the bookings of that application as the plan read them from
// ProvedOn on (carecontract.EnrollmentPlanRow.ApplicationBookings), and the
// answer is existing only when they are still the stored ones.
//
// Confirmed is the child record as the office confirmed it in the preview.
// The caller that shows a preview passes it for every row; the child record
// read under the gates must still carry that name and date of birth, else
// the answer is changed. Without it nothing is compared: only a caller that
// showed no child record to anyone leaves it out.
type ContractEnrollment struct {
	StudentID    int64
	PhaseID      int64
	ContractID   int64
	Confirmed    *ContractChildIdentity
	ServiceStart calendar.Date
	ServiceEnd   calendar.Date
	// RequestChildID names the approved application child the plan proved;
	// 0 for a child to enroll. ProvedOn is the day of that plan.
	RequestChildID int64
	ProvedOn       calendar.Date
	Bookings       []ContractBooking
	Changes        []ContractBookingChange
	ActorAccountID int64
}

// ContractChildIdentity is what a preview showed of a child record: the name
// and the date of birth of its person, BirthDate nil without one. A child
// record the preview could not show is the empty identity.
type ContractChildIdentity struct {
	FirstName string
	LastName  string
	BirthDate *calendar.Date
}

// ContractEnrollmentResult answers one ContractEnrollment. RequestID and
// RequestChildID name the enrollment made or found, or the other
// application of the child.
type ContractEnrollmentResult struct {
	ContractID     int64
	StudentID      int64
	Status         string
	Reason         string
	RequestID      int64
	RequestChildID int64
}

// ContractEnrollmentHolder is a request child of a phase that created or
// renews a student, with the source of its request; and a request child of
// the source contract_import of the student in any other phase.
type ContractEnrollmentHolder struct {
	StudentID int64
	// PhaseID is the phase of the request. ContractID is the imported
	// contract a request of the source contract_import was made for; 0 for
	// any other request.
	PhaseID          int64
	ContractID       int64
	RequestID        int64
	RequestChildID   int64
	Status           string
	SubmissionSource string
	// Created tells that the child is linked to the student as the one it
	// created (created_student_id), not only matched to it.
	Created bool
	// MatchedByOffice tells that the office matched the child to the child
	// record: no contract is bound to such an application (#6053).
	MatchedByOffice bool
}

// ContractEnrollmentWrite is the request of one contract enrollment with its
// child and the submitted choices of that child, as the store writes them in
// sets. The store fills in the ids.
type ContractEnrollmentWrite struct {
	Request *Request
	Child   *RequestChild
	Choices []SubmittedOfferingChoice
}

// ContractChildApproval approves the child of one contract enrollment for
// the account that acted.
type ContractChildApproval struct {
	RequestChildID int64
	ReviewedBy     int64
}

// ContractEnrollmentStamp is the instant and the reason the store stamps on
// the rows of one run.
type ContractEnrollmentStamp struct {
	At     time.Time
	Reason string
}

// ContractStudent is a child record with its person as the enrollment of
// the children of imported contracts reads it.
type ContractStudent struct {
	ID               int64
	Status           string
	WithoutCarePlace bool
	FirstName        string
	LastName         string
	// Birthday is nil for a person without a date of birth, and for a child
	// record without a person.
	Birthday *calendar.Date
	// CareEnd is the last care day the child record names (enrolled_until);
	// nil without one.
	CareEnd *calendar.Date
}

// ContractEnrollments enrolls the children of imported care contracts in the
// school whose tenant transaction the caller holds. Both operations answer
// the inputs in their order.
type ContractEnrollments interface {
	// CheckContractChildren answers what EnrollContractChildren would do
	// with each child, and writes and locks nothing. Its answer for a row
	// that names an application is a preview: only the answer under the
	// locks of EnrollContractChildren confirms an application for a binding.
	// The caller relates an answer to its row by ContractID and StudentID.
	CheckContractChildren(ctx context.Context, enrollments []ContractEnrollment) ([]ContractEnrollmentResult, error)
	// EnrollContractChildren enrolls each child that can be enrolled, and
	// confirms each application a row names, under the approval gates of
	// the school and the lock of each phase.
	EnrollContractChildren(ctx context.Context, enrollments []ContractEnrollment) ([]ContractEnrollmentResult, error)
}
