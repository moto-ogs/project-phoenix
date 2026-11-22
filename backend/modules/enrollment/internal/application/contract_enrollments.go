package application

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The enrollment of the children of imported care contracts (#7760, ADR
// 0309). It is the approval of a request no parent submitted, for a child
// record that exists: it takes the steps of an approval that derive care
// from bookings and none that touch the child record, a guardian or a
// parent. The steps it leaves out on purpose are the intake (Submit), the
// decision with its mails and invitation (Decide, DecideAndInvite), the
// renewal of the child record (renewExistingStudent), everything about the
// guardian (reconcileRenewalGuardian, attachGuardianAccountIfPresent,
// linkAdditionalGuardians), the targeted form fields, the weekly plan, the
// activation plan, and the announcement of the pickup projection, which
// reaches the guardians in the parents portal.
//
// This file reads and checks; contract_enrollment_run.go writes.

// contractEnrollmentReason is the reason an approved child of an imported
// contract carries; the office reads it at the enrollment.
const contractEnrollmentReason = "Aus importiertem Vertrag"

// contractStale is the booking reason of a phase or an offering that is no
// longer what the plan read; the child is answered as changed.
const contractStale = "stale"

// ContractStudents reads the child records of a run with their persons in
// a fixed number of statements. A child record the school does not have is
// not in the answer. The root binds People Directory.
type ContractStudents interface {
	ContractEnrollmentStudents(ctx context.Context, studentIDs []int64) (map[int64]enrollmentNative.ContractStudent, error)
}

var _ enrollmentNative.ContractEnrollments = (*Decisions)(nil)

// CheckContractChildren answers what the enrollment would do, without a
// write or a lock.
func (d *Decisions) CheckContractChildren(ctx context.Context, enrollments []enrollmentNative.ContractEnrollment) (publicResult []enrollmentNative.ContractEnrollmentResult, publicErr error) {
	defer func() { publicErr = PublicError(publicErr) }()
	results := make([]enrollmentNative.ContractEnrollmentResult, len(enrollments))
	if err := d.requireContractEnrollments(enrollments); err != nil || len(enrollments) == 0 {
		return results, err
	}
	ids, students := contractPhaseStudents(enrollments)
	rows, err := d.deps.Phases.PhasesByID(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("contract enrollment: load phases: %w", err)
	}
	run := &contractRun{phases: make(map[int64]*contractPhase, len(rows))}
	for _, row := range rows {
		if row == nil {
			continue
		}
		if run.phases[row.ID], err = d.readContractPhase(ctx, row, students[row.ID]); err != nil {
			return nil, err
		}
	}
	if err := d.readContractStudents(ctx, run, enrollments); err != nil {
		return nil, err
	}
	for i, input := range enrollments {
		run.check(i, input, &results[i])
	}
	return results, nil
}

// contractRun is one call: its phases, the child records it names, and the
// children it is going to enroll.
type contractRun struct {
	phases   map[int64]*contractPhase
	students map[int64]enrollmentNative.ContractStudent
	pending  []*contractSubject
}

// contractPhase is one phase of a run with what its children are checked
// against: the phase, its offerings, the request children that hold the
// students and the bookings of the enrollments of this source among them.
type contractPhase struct {
	phase     *enrollmentNative.Phase
	offerings map[int64]*offeringContract.CareOfferingRecord
	holders   map[int64][]enrollmentNative.ContractEnrollmentHolder
	stored    map[int64][]*enrollmentNative.RequestChildOffering
	// enrolling are the children this call enrolls, by child record: a
	// second row of a child record finds the first one.
	enrolling map[int64]*contractSubject
}

// window is the booking window of the phase: its first day of care and the
// exclusive day after the last one.
func (p *contractPhase) window() (from, until calendar.Date) {
	return calendar.Date(p.phase.ServiceStartDate), calendar.Date(p.phase.ServiceEndDate).AddDays(1)
}

// contractPhaseStudents are the phases of a run in ascending order, each
// with the students asked for.
func contractPhaseStudents(enrollments []enrollmentNative.ContractEnrollment) ([]int64, map[int64][]int64) {
	students := map[int64][]int64{}
	for _, input := range enrollments {
		students[input.PhaseID] = append(students[input.PhaseID], input.StudentID)
	}
	ids := make([]int64, 0, len(students))
	for id := range students {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids, students
}

func (d *Decisions) requireContractEnrollments(enrollments []enrollmentNative.ContractEnrollment) error {
	if d.deps.ContractStudents == nil || d.deps.PhaseHolders == nil || d.deps.CareBookings == nil ||
		d.deps.Offerings == nil || d.deps.Phases == nil || d.deps.Children == nil || d.deps.Requests == nil {
		return errors.New("contract enrollment: the records, the bookings, the child records, the offerings and the phases are required")
	}
	for _, input := range enrollments {
		if input.StudentID <= 0 || input.PhaseID <= 0 || input.ContractID <= 0 || input.ActorAccountID <= 0 {
			return errors.New("contract enrollment: student, phase, contract and acting account are required")
		}
	}
	return nil
}

// lockContractPhases takes the approval gates, reads the phases under the
// recurrence gate, takes the match lock of each in ascending order and reads
// what its children are checked against: a fixed number of reads per phase.
func (d *Decisions) lockContractPhases(ctx context.Context, enrollments []enrollmentNative.ContractEnrollment) (map[int64]*contractPhase, error) {
	if err := d.LockApprovalGates(ctx); err != nil {
		return nil, err
	}
	ids, students := contractPhaseStudents(enrollments)
	locked, err := enrollmentNative.NewPhaseBoundsReader(d.deps.Phases, d.deps.LockTemplateRecurrence).LockedPhases(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("contract enrollment: load phases: %w", err)
	}
	phases := make(map[int64]*contractPhase, len(locked))
	for _, id := range ids {
		phase, found := locked[id]
		if !found {
			continue
		}
		if err := d.deps.Requests.AcquireExistingStudentMatchLock(ctx, id); err != nil {
			return nil, fmt.Errorf("contract enrollment: lock phase %d: %w", id, err)
		}
		if phases[id], err = d.readContractPhase(ctx, phase.Phase(), students[id]); err != nil {
			return nil, err
		}
	}
	return phases, nil
}

// readContractPhase reads the offerings of a phase, the request children
// that hold the students and, in one read, the bookings of those of them
// that are enrollments of this source.
func (d *Decisions) readContractPhase(ctx context.Context, row *enrollmentNative.Phase, students []int64) (*contractPhase, error) {
	offerings, err := d.deps.Offerings.ListByPhase(ctx, row.ID)
	if err != nil {
		return nil, fmt.Errorf("contract enrollment: list offerings of phase %d: %w", row.ID, err)
	}
	holders, err := d.deps.PhaseHolders.ContractEnrollmentHolders(ctx, row.ID, students)
	if err != nil {
		return nil, fmt.Errorf("contract enrollment: read applications of phase %d: %w", row.ID, err)
	}
	phase := &contractPhase{phase: row, offerings: make(map[int64]*offeringContract.CareOfferingRecord, len(offerings)),
		holders: map[int64][]enrollmentNative.ContractEnrollmentHolder{}, stored: map[int64][]*enrollmentNative.RequestChildOffering{},
		enrolling: map[int64]*contractSubject{}}
	for _, offering := range offerings {
		if offering != nil {
			phase.offerings[offering.ID] = offering
		}
	}
	own := []int64{}
	for _, holder := range holders {
		phase.holders[holder.StudentID] = append(phase.holders[holder.StudentID], holder)
		if ownContractEnrollment(holder) {
			own = append(own, holder.RequestChildID)
		}
	}
	if len(own) == 0 {
		return phase, nil
	}
	start, _ := phase.window()
	stored, err := d.deps.Children.RequestChildOfferingsForChildrenAtDate(ctx, own, enrollmentNative.Date(start))
	if err != nil {
		return nil, fmt.Errorf("contract enrollment: read bookings of phase %d: %w", row.ID, err)
	}
	for _, booking := range stored {
		if booking != nil {
			phase.stored[booking.RequestChildID] = append(phase.stored[booking.RequestChildID], booking)
		}
	}
	return phase, nil
}

// readContractStudents reads the child records of the run with their
// persons: two reads, however many children.
func (d *Decisions) readContractStudents(ctx context.Context, run *contractRun, enrollments []enrollmentNative.ContractEnrollment) error {
	ids := make([]int64, 0, len(enrollments))
	for _, input := range enrollments {
		if !slices.Contains(ids, input.StudentID) {
			ids = append(ids, input.StudentID)
		}
	}
	students, err := d.deps.ContractStudents.ContractEnrollmentStudents(ctx, ids)
	if err != nil {
		return fmt.Errorf("contract enrollment: read child records: %w", err)
	}
	run.students = students
	return nil
}

// contractSubject is a child the call enrolls: its input, its child record
// and the bookings as they are stored, then the rows written for it.
type contractSubject struct {
	index    int
	input    enrollmentNative.ContractEnrollment
	phase    *contractPhase
	student  enrollmentNative.ContractStudent
	bookings []enrollmentNative.CareBookingInput
	// repeats are the later rows of the same child record with the same
	// bookings: they are answered with the enrollment of this one.
	repeats []int
	write   enrollmentNative.ContractEnrollmentWrite
}

// check answers one child into result, from what the run read: it reads
// nothing itself. A child to enroll is added to the pending ones.
func (r *contractRun) check(index int, input enrollmentNative.ContractEnrollment, result *enrollmentNative.ContractEnrollmentResult) {
	*result = enrollmentNative.ContractEnrollmentResult{ContractID: input.ContractID, StudentID: input.StudentID,
		Status: enrollmentNative.ContractEnrollmentRefused}
	phase := r.phases[input.PhaseID]
	if phase == nil {
		result.Reason = enrollmentNative.ContractEnrollmentPhaseMissing
		return
	}
	bookings, reason := contractBookings(phase, input)
	// An application of the phase answers first: it names what the child
	// has, whatever the child record says by now.
	if holder, held := contractHolder(phase.holders[input.StudentID]); held {
		answerContractHolder(holder, phase, bookings, reason, result)
		return
	}
	if first := phase.enrolling[input.StudentID]; first != nil {
		answerContractRepeat(first, index, bookings, reason, result)
		return
	}
	student, known := r.students[input.StudentID]
	if refusal := contractStudentRefusal(student, known); refusal != "" {
		reason = refusal
	}
	if reason == "" && len(input.Changes) > 0 {
		reason = enrollmentNative.ContractEnrollmentPlannedChange
	}
	if reason == "" && (student.Birthday == nil || student.Birthday.IsZero()) {
		reason = enrollmentNative.ContractEnrollmentBirthDateMissing
	}
	if reason != "" {
		refuseContractChild(reason, result)
		return
	}
	result.Status = enrollmentNative.ContractEnrollmentEnrolled
	subject := &contractSubject{index: index, input: input, phase: phase, student: student, bookings: bookings}
	phase.enrolling[input.StudentID] = subject
	r.pending = append(r.pending, subject)
}

// refuseContractChild answers a child that is not enrolled: as changed when
// its phase or an offering is no longer what the plan read, else refused
// with the reason.
func refuseContractChild(reason string, result *enrollmentNative.ContractEnrollmentResult) {
	if reason == contractStale {
		result.Status = enrollmentNative.ContractEnrollmentChanged
		return
	}
	result.Status, result.Reason = enrollmentNative.ContractEnrollmentRefused, reason
}

// contractStudentRefusal tells why a child record gets no enrollment: it is
// gone, not active, or has no OGS place, which an enrollment would grant.
func contractStudentRefusal(student enrollmentNative.ContractStudent, known bool) string {
	switch {
	case !known:
		return enrollmentNative.ContractEnrollmentStudentMissing
	case student.Status != studentStatusActive:
		return enrollmentNative.ContractEnrollmentStudentInactive
	case student.WithoutCarePlace:
		return enrollmentNative.ContractEnrollmentWithoutCarePlace
	}
	return ""
}

// contractHolder is the request child that decides for a student: another
// application before an enrollment of this source.
func contractHolder(holders []enrollmentNative.ContractEnrollmentHolder) (enrollmentNative.ContractEnrollmentHolder, bool) {
	for _, holder := range holders {
		if !ownContractEnrollment(holder) {
			return holder, true
		}
	}
	if len(holders) == 0 {
		return enrollmentNative.ContractEnrollmentHolder{}, false
	}
	return holders[0], true
}

// ownContractEnrollment tells whether a holder is the approved enrollment of
// this source that created its link to the student.
func ownContractEnrollment(holder enrollmentNative.ContractEnrollmentHolder) bool {
	return holder.Created && holder.Status == enrollmentNative.ChildStatusApproved &&
		enrollmentNative.NormalizedSubmissionSource(holder.SubmissionSource) == enrollmentNative.RequestSourceContractImport
}

// answerContractHolder answers a student that a request child of the phase
// holds: its own enrollment with the bookings given is the answer of a
// repeated call, with other bookings it is refused, and any other
// application is named.
func answerContractHolder(holder enrollmentNative.ContractEnrollmentHolder, phase *contractPhase,
	bookings []enrollmentNative.CareBookingInput, reason string, result *enrollmentNative.ContractEnrollmentResult) {
	result.RequestID, result.RequestChildID = holder.RequestID, holder.RequestChildID
	switch {
	case !ownContractEnrollment(holder):
		result.Status = enrollmentNative.ContractEnrollmentHasApplication
	case reason == contractStale:
		result.Status = enrollmentNative.ContractEnrollmentChanged
	case reason != "" || !sameContractBookings(phase.stored[holder.RequestChildID], bookings):
		result.Reason = enrollmentNative.ContractEnrollmentBookingsDiffer
	default:
		result.Status = enrollmentNative.ContractEnrollmentExisting
	}
}

// answerContractRepeat answers a later row of a child record the call
// enrolls already: with the same bookings it gets the enrollment of the
// first row, with others it is refused.
func answerContractRepeat(first *contractSubject, index int, bookings []enrollmentNative.CareBookingInput, reason string,
	result *enrollmentNative.ContractEnrollmentResult) {
	switch {
	case reason == contractStale:
		result.Status = enrollmentNative.ContractEnrollmentChanged
	case reason != "" || !sameBookingInputs(first.bookings, bookings):
		result.Reason = enrollmentNative.ContractEnrollmentBookingsDiffer
	default:
		result.Status = enrollmentNative.ContractEnrollmentExisting
		first.repeats = append(first.repeats, index)
	}
}

// contractBookings checks the bookings against the phase and answers them
// as they are stored. First the phase and each offering must still be what
// the plan read (contractStale otherwise). Then each offering is one of the
// phase and booked once, on weekdays it offers, from the service start of
// the phase to a day within it. An offering with fixed weekdays is booked
// on all of them and stores none, like a submission.
func contractBookings(phase *contractPhase, input enrollmentNative.ContractEnrollment) ([]enrollmentNative.CareBookingInput, string) {
	start, until := phase.window()
	if input.ServiceStart != start || input.ServiceEnd.IsZero() || input.ServiceEnd.AddDays(1) != until {
		return nil, contractStale
	}
	if len(input.Bookings) == 0 {
		return nil, enrollmentNative.ContractEnrollmentOfferingPhase
	}
	inputs := make([]enrollmentNative.CareBookingInput, 0, len(input.Bookings))
	seen := map[int64]bool{}
	for _, booking := range input.Bookings {
		offering := phase.offerings[booking.CareOfferingID]
		if offering == nil {
			return nil, enrollmentNative.ContractEnrollmentOfferingPhase
		}
		if !offeringAsPlanned(offering, booking) {
			return nil, contractStale
		}
		days, ok := contractBookingDays(offering, booking.Days)
		if !ok {
			return nil, enrollmentNative.ContractEnrollmentDayUnavailable
		}
		if seen[offering.ID] || booking.ValidFrom != start || !booking.ValidUntil.After(start) || booking.ValidUntil.After(until) {
			return nil, enrollmentNative.ContractEnrollmentBookingWindow
		}
		seen[offering.ID] = true
		from, end := booking.ValidFrom, booking.ValidUntil
		inputs = append(inputs, enrollmentNative.CareBookingInput{CareOfferingID: offering.ID, ManualSelectedDays: days, ValidFrom: &from, ValidUntil: &end})
	}
	return inputs, ""
}

// offeringAsPlanned tells whether the offering is still what the plan read
// and proved the booking on: the same weekday mode, the same weekdays on
// offer and, on each booked weekday, the same end time.
func offeringAsPlanned(offering *offeringContract.CareOfferingRecord, booking enrollmentNative.ContractBooking) bool {
	if offering.DaysOfWeekMode != booking.DaysOfWeekMode || !sameWeekdays(offering.AvailableDays, booking.AvailableDays) {
		return false
	}
	for _, day := range booking.Days {
		day = normalizedWeekday(day)
		if plannedEndTime(offering.PickupTimes[day]) != booking.EndTimes[day] {
			return false
		}
	}
	return true
}

// plannedEndTime is the end time of an offering as the plan of the Träger
// reads it (Care Plan's contract offerings): a clock time as "HH:MM",
// anything else no end time.
func plannedEndTime(stored string) string {
	for _, layout := range []string{"15:04", "15:04:05"} {
		if clock, err := time.Parse(layout, strings.TrimSpace(stored)); err == nil {
			return clock.Format("15:04")
		}
	}
	return ""
}

func normalizedWeekday(day string) string { return strings.ToLower(strings.TrimSpace(day)) }

// sameWeekdays compares two lists of weekdays as sets.
func sameWeekdays(a, b []string) bool {
	set := func(days []string) []string {
		normalized := make([]string, 0, len(days))
		for _, day := range days {
			normalized = append(normalized, normalizedWeekday(day))
		}
		slices.Sort(normalized)
		return slices.Compact(normalized)
	}
	return slices.Equal(set(a), set(b))
}

// contractBookingDays are the weekdays a booking stores, lower-cased and in
// the order given; false for a weekday the offering does not offer, no
// weekday, or a subset of fixed weekdays.
func contractBookingDays(offering *offeringContract.CareOfferingRecord, days []string) ([]string, bool) {
	normalized := make([]string, 0, len(days))
	for _, day := range days {
		day = normalizedWeekday(day)
		if !slices.Contains(offering.AvailableDays, day) || slices.Contains(normalized, day) {
			return nil, false
		}
		normalized = append(normalized, day)
	}
	if offering.DaysOfWeekMode == offeringContract.DaysOfWeekModeFixed {
		return nil, len(normalized) == len(offering.AvailableDays)
	}
	return normalized, len(normalized) > 0
}

func contractBookingKey(offeringID int64, days []string, from, until *calendar.Date) string {
	sorted := slices.Clone(days)
	slices.Sort(sorted)
	return fmt.Sprint(offeringID, sorted, contractDay(from), contractDay(until))
}

func bookingInputKeys(bookings []enrollmentNative.CareBookingInput) []string {
	keys := make([]string, 0, len(bookings))
	for _, booking := range bookings {
		keys = append(keys, contractBookingKey(booking.CareOfferingID, booking.ManualSelectedDays, booking.ValidFrom, booking.ValidUntil))
	}
	slices.Sort(keys)
	return keys
}

// sameContractBookings compares the stored bookings of a child with the
// ones given: the same offerings, weekdays and times.
func sameContractBookings(stored []*enrollmentNative.RequestChildOffering, bookings []enrollmentNative.CareBookingInput) bool {
	have := make([]string, 0, len(stored))
	for _, row := range stored {
		if row != nil {
			have = append(have, contractBookingKey(row.CareOfferingID, row.ManualSelectedDays, (*calendar.Date)(row.ValidFrom), (*calendar.Date)(row.ValidUntil)))
		}
	}
	slices.Sort(have)
	return slices.Equal(have, bookingInputKeys(bookings))
}

// sameBookingInputs compares the bookings of two rows of one call.
func sameBookingInputs(a, b []enrollmentNative.CareBookingInput) bool {
	return slices.Equal(bookingInputKeys(a), bookingInputKeys(b))
}

func contractDay(day *calendar.Date) string {
	if day == nil {
		return ""
	}
	return day.String()
}
