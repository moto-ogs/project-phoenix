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
//     the parents portal.
//   - It writes one request with one approved child per contract, linked to
//     the child record that exists, with the bookings given and the rosters
//     an approval derives from them.
//   - A repeated call writes nothing twice: a child that has the enrollment
//     of this source in the phase is answered with it.
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
//     weekdays and the weekday mode of the offering. A child whose phase or
//     offering changed since the plan is answered as changed and gets no
//     enrollment.
//   - A row that cannot be enrolled is refused with its reason and writes
//     nothing; the other rows go on.
//   - The statements of the capability itself do not grow with the number
//     of children: it reads and writes its rows in sets. The care a child's
//     bookings derive (the bookings, the rosters and the multi-source
//     rosters) is written by Care Plan's building blocks of an approval,
//     one child at a time (ADR 0309).

// What the enrollment did with a child.
const (
	// ContractEnrollmentEnrolled is a child the call enrolled; a check
	// answers it for a child the call would enroll.
	ContractEnrollmentEnrolled = "enrolled"
	// ContractEnrollmentExisting is a child that has the enrollment of this
	// source in the phase already, with the bookings given.
	ContractEnrollmentExisting = "existing"
	// ContractEnrollmentHasApplication is a child with another application
	// in the phase; RequestID names it, RequestChildID its child. A contract
	// is never bound to it.
	ContractEnrollmentHasApplication = "has_application"
	// ContractEnrollmentChanged is a child whose phase or offering is no
	// longer what the plan read: the service of the phase moved, or an
	// offering has other end times, weekdays or another weekday mode. It
	// writes nothing; the caller plans again.
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
	// ContractEnrollmentBookingWindow is a booking that does not start with
	// the service of the phase, where the roster of an approved child is
	// read, does not end within it, or names an offering twice.
	ContractEnrollmentBookingWindow = "booking_window"
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
// the bookings that hold from the service start of the phase, the planned
// changes after it, the contract they come from and the account that acts.
// ServiceStart and ServiceEnd are the first and the last day of the service
// of the phase as the plan read them.
type ContractEnrollment struct {
	StudentID      int64
	PhaseID        int64
	ContractID     int64
	ServiceStart   calendar.Date
	ServiceEnd     calendar.Date
	Bookings       []ContractBooking
	Changes        []ContractBookingChange
	ActorAccountID int64
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
// renews a student, with the source of its request.
type ContractEnrollmentHolder struct {
	StudentID        int64
	RequestID        int64
	RequestChildID   int64
	Status           string
	SubmissionSource string
	// Created tells that the child is linked to the student as the one it
	// created (created_student_id), not only matched to it.
	Created bool
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
}

// ContractEnrollments enrolls the children of imported care contracts in the
// school whose tenant transaction the caller holds. Both operations answer
// the inputs in their order.
type ContractEnrollments interface {
	// CheckContractChildren answers what EnrollContractChildren would do
	// with each child, and writes and locks nothing.
	CheckContractChildren(ctx context.Context, enrollments []ContractEnrollment) ([]ContractEnrollmentResult, error)
	// EnrollContractChildren enrolls each child that can be enrolled, under
	// the approval gates of the school and the lock of each phase.
	EnrollContractChildren(ctx context.Context, enrollments []ContractEnrollment) ([]ContractEnrollmentResult, error)
}
