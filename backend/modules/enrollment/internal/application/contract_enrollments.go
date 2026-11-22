package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

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

// contractEnrollmentReason is the reason an approved child of an imported
// contract carries; the office reads it at the enrollment.
const contractEnrollmentReason = "Aus importiertem Vertrag"

// ContractEnrollmentRecords writes the request of a contract enrollment, its
// child and the submitted choices. The root binds the Enrollment owner on
// its clock, as for Requests and Children.
type ContractEnrollmentRecords interface {
	InsertRequest(ctx context.Context, request *enrollmentNative.Request) error
	InsertChild(ctx context.Context, child *enrollmentNative.RequestChild) error
	RecordSubmittedOfferingChoices(ctx context.Context, childID int64, choices []enrollmentNative.SubmittedOfferingChoice) error
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
	phases := make(map[int64]*contractPhase, len(rows))
	for _, row := range rows {
		if row == nil {
			continue
		}
		if phases[row.ID], err = d.readContractPhase(ctx, row, students[row.ID]); err != nil {
			return nil, err
		}
	}
	for i, input := range enrollments {
		if _, err := d.checkContractChild(ctx, input, phases[input.PhaseID], &results[i]); err != nil {
			return nil, err
		}
	}
	return results, nil
}

// EnrollContractChildren enrolls each child that can be enrolled. It takes
// the approval gates first, then the match lock of each phase in ascending
// order, before any row lock (ADR 0162).
func (d *Decisions) EnrollContractChildren(ctx context.Context, enrollments []enrollmentNative.ContractEnrollment) (publicResult []enrollmentNative.ContractEnrollmentResult, publicErr error) {
	defer func() { publicErr = PublicError(publicErr) }()
	results := make([]enrollmentNative.ContractEnrollmentResult, len(enrollments))
	if err := d.requireContractEnrollments(enrollments); err != nil || len(enrollments) == 0 {
		return results, err
	}
	phases, err := d.lockContractPhases(ctx, enrollments)
	if err != nil {
		return nil, err
	}
	for i, input := range enrollments {
		phase := phases[input.PhaseID]
		subject, err := d.checkContractChild(ctx, input, phase, &results[i])
		if err != nil {
			return nil, err
		}
		if subject == nil {
			continue
		}
		if err := d.enrollContractChild(ctx, input, phase, subject, &results[i]); err != nil {
			return nil, fmt.Errorf("contract enrollment: student %d: %w", input.StudentID, err)
		}
		// A second row of the same student in this run finds the enrollment
		// the first one made.
		phase.holders[input.StudentID] = append(phase.holders[input.StudentID], enrollmentNative.ContractEnrollmentHolder{
			StudentID: input.StudentID, RequestID: results[i].RequestID, RequestChildID: results[i].RequestChildID,
			Status: enrollmentNative.ChildStatusApproved, SubmissionSource: enrollmentNative.RequestSourceContractImport, Created: true})
	}
	return results, nil
}

// contractPhase is one phase of a run with what its children are checked
// against: the phase, its offerings and the request children that hold the
// students.
type contractPhase struct {
	phase     *enrollmentNative.Phase
	offerings map[int64]*offeringContract.CareOfferingRecord
	holders   map[int64][]enrollmentNative.ContractEnrollmentHolder
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
	if d.deps.ContractRecords == nil || d.deps.PhaseHolders == nil || d.deps.CareBookings == nil || d.deps.StudentEnrollment == nil ||
		d.deps.People.Persons == nil || d.deps.Offerings == nil || d.deps.Phases == nil || d.deps.Children == nil || d.deps.Requests == nil {
		return errors.New("contract enrollment: the records, the bookings, the student and person reads, the offerings and the phases are required")
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

// readContractPhase reads the offerings of a phase and the request children
// that hold the students.
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
		holders: map[int64][]enrollmentNative.ContractEnrollmentHolder{}}
	for _, offering := range offerings {
		if offering != nil {
			phase.offerings[offering.ID] = offering
		}
	}
	for _, holder := range holders {
		phase.holders[holder.StudentID] = append(phase.holders[holder.StudentID], holder)
	}
	return phase, nil
}

// contractSubject is a child that can be enrolled: its person and the
// bookings as they are stored.
type contractSubject struct {
	person   *Person
	bookings []enrollmentNative.CareBookingInput
}

// checkContractChild answers one child into result. It returns the subject
// of a child to enroll, nil for every other answer.
func (d *Decisions) checkContractChild(ctx context.Context, input enrollmentNative.ContractEnrollment, phase *contractPhase,
	result *enrollmentNative.ContractEnrollmentResult) (*contractSubject, error) {
	*result = enrollmentNative.ContractEnrollmentResult{ContractID: input.ContractID, StudentID: input.StudentID,
		Status: enrollmentNative.ContractEnrollmentRefused}
	if phase == nil {
		result.Reason = enrollmentNative.ContractEnrollmentPhaseMissing
		return nil, nil
	}
	student, err := d.readEnrollmentStudent(ctx, input.StudentID, "")
	if err != nil && !d.deps.Runtime.NotFound(err) {
		return nil, fmt.Errorf("contract enrollment: read student %d: %w", input.StudentID, err)
	}
	bookings, reason := contractBookings(phase, input.Bookings)
	// An application of the phase answers first: it names what the child
	// has, whatever the child record says by now.
	if holder, held := contractHolder(phase.holders[input.StudentID]); held {
		return nil, d.answerContractHolder(ctx, holder, phase, bookings, reason, result)
	}
	if refusal := contractStudentRefusal(student); refusal != "" {
		reason = refusal
	}
	if reason == "" && len(input.Changes) > 0 {
		reason = enrollmentNative.ContractEnrollmentPlannedChange
	}
	if reason != "" {
		result.Reason = reason
		return nil, nil
	}
	person, err := d.deps.People.Persons.PersonByID(ctx, student.PersonID)
	if err != nil {
		return nil, fmt.Errorf("contract enrollment: read person of student %d: %w", input.StudentID, err)
	}
	if person == nil || person.Birthday == nil || person.Birthday.IsZero() {
		result.Reason = enrollmentNative.ContractEnrollmentBirthDateMissing
		return nil, nil
	}
	result.Status = enrollmentNative.ContractEnrollmentEnrolled
	return &contractSubject{person: person, bookings: bookings}, nil
}

// contractStudentRefusal tells why a child record gets no enrollment: it is
// gone, not active, or has no OGS place, which an enrollment would grant.
func contractStudentRefusal(student *Student) string {
	switch {
	case student == nil:
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
func (d *Decisions) answerContractHolder(ctx context.Context, holder enrollmentNative.ContractEnrollmentHolder, phase *contractPhase,
	bookings []enrollmentNative.CareBookingInput, reason string, result *enrollmentNative.ContractEnrollmentResult) error {
	result.RequestID, result.RequestChildID = holder.RequestID, holder.RequestChildID
	if !ownContractEnrollment(holder) {
		result.Status = enrollmentNative.ContractEnrollmentHasApplication
		return nil
	}
	start, _ := phase.window()
	stored, err := d.deps.Children.RequestChildOfferingsAtDate(ctx, holder.RequestChildID, enrollmentNative.Date(start))
	if err != nil {
		return fmt.Errorf("contract enrollment: read bookings of child %d: %w", holder.RequestChildID, err)
	}
	if reason != "" || !sameContractBookings(stored, bookings) {
		result.Reason = enrollmentNative.ContractEnrollmentBookingsDiffer
		return nil
	}
	result.Status = enrollmentNative.ContractEnrollmentExisting
	return nil
}

// contractBookings checks the bookings against the phase and answers them
// as they are stored: each offering is one of the phase and booked once, on
// weekdays it offers, from the service start of the phase to a day within
// it. An offering with fixed weekdays is booked on all of them and stores
// none, like a submission.
func contractBookings(phase *contractPhase, bookings []enrollmentNative.ContractBooking) ([]enrollmentNative.CareBookingInput, string) {
	start, until := phase.window()
	if len(bookings) == 0 {
		return nil, enrollmentNative.ContractEnrollmentOfferingPhase
	}
	inputs := make([]enrollmentNative.CareBookingInput, 0, len(bookings))
	seen := map[int64]bool{}
	for _, booking := range bookings {
		offering := phase.offerings[booking.CareOfferingID]
		if offering == nil {
			return nil, enrollmentNative.ContractEnrollmentOfferingPhase
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

// contractBookingDays are the weekdays a booking stores, lower-cased and in
// the order given; false for a weekday the offering does not offer, no
// weekday, or a subset of fixed weekdays.
func contractBookingDays(offering *offeringContract.CareOfferingRecord, days []string) ([]string, bool) {
	normalized := make([]string, 0, len(days))
	for _, day := range days {
		day = strings.ToLower(strings.TrimSpace(day))
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

// sameContractBookings compares the stored bookings of a child with the
// ones given: the same offerings, weekdays and times.
func sameContractBookings(stored []*enrollmentNative.RequestChildOffering, bookings []enrollmentNative.CareBookingInput) bool {
	key := func(offeringID int64, days []string, from, until *calendar.Date) string {
		sorted := slices.Clone(days)
		slices.Sort(sorted)
		return fmt.Sprint(offeringID, sorted, contractDay(from), contractDay(until))
	}
	have := make([]string, 0, len(stored))
	for _, row := range stored {
		if row != nil {
			have = append(have, key(row.CareOfferingID, row.ManualSelectedDays, (*calendar.Date)(row.ValidFrom), (*calendar.Date)(row.ValidUntil)))
		}
	}
	want := make([]string, 0, len(bookings))
	for _, booking := range bookings {
		want = append(want, key(booking.CareOfferingID, booking.ManualSelectedDays, booking.ValidFrom, booking.ValidUntil))
	}
	slices.Sort(have)
	slices.Sort(want)
	return slices.Equal(have, want)
}

func contractDay(day *calendar.Date) string {
	if day == nil {
		return ""
	}
	return day.String()
}

// enrollContractChild writes the request, its approved child and the care
// derived from the bookings, in the order of an approval: the request and
// the child, the submitted choices and the bookings, the link to the child
// record, the rosters, the approval, the multi-source rosters and the
// pickup effects of the staff.
func (d *Decisions) enrollContractChild(ctx context.Context, input enrollmentNative.ContractEnrollment, phase *contractPhase,
	subject *contractSubject, result *enrollmentNative.ContractEnrollmentResult) error {
	request, child, err := d.insertContractRequest(ctx, input, phase.phase, subject.person)
	if err != nil {
		return err
	}
	choices := make([]enrollmentNative.SubmittedOfferingChoice, len(subject.bookings))
	for i, booking := range subject.bookings {
		choices[i] = enrollmentNative.SubmittedOfferingChoice{CareOfferingID: booking.CareOfferingID, SelectedDays: booking.ManualSelectedDays,
			Terms: submittedOfferingTerms(phase.offerings[booking.CareOfferingID])}
	}
	if err := d.deps.ContractRecords.RecordSubmittedOfferingChoices(ctx, child.ID, choices); err != nil {
		return fmt.Errorf("record offering choices: %w", err)
	}
	if err := d.deps.CareBookings.RecordCareBookings(ctx, child.ID, subject.bookings); err != nil {
		return fmt.Errorf("record care bookings: %w", err)
	}
	// Linked before the rosters: the roster resync resolves the child's
	// student through created_student_id.
	if err := d.deps.Children.LinkCreatedStudent(ctx, child.ID, input.StudentID); err != nil {
		return fmt.Errorf("link student: %w", err)
	}
	if err := d.materializeApprovedOfferings(ctx, child.ID, input.StudentID, phase.phase); err != nil {
		return err
	}
	reason := contractEnrollmentReason
	if err := d.deps.Children.UpdateChildStatus(ctx, child.ID, enrollmentNative.ChildStatusApproved, &reason, input.ActorAccountID); err != nil {
		return fmt.Errorf("approve child: %w", err)
	}
	if err := d.resyncMultiSourceTemplatesForChild(ctx, child.ID, phase.phase); err != nil {
		return fmt.Errorf("resync multi-source templates: %w", err)
	}
	// The pickup auto excusals of the staff follow the bookings. The
	// announcement of the pickup projection is left out: it reaches the
	// child's guardians in the parents portal.
	if d.deps.Pickups.ResyncExcusal != nil {
		if err := d.deps.Pickups.ResyncExcusal(ctx, []int64{input.StudentID}); err != nil {
			return fmt.Errorf("resync pickup auto excusals: %w", err)
		}
	}
	result.RequestID, result.RequestChildID = request.ID, child.ID
	d.logger().Info("contract enrollment created",
		slog.Int64("request_id", request.ID),
		slog.Int64("request_child_id", child.ID),
		slog.Int64("student_id", input.StudentID),
		slog.Int64("contract_id", input.ContractID),
		slog.Int64("reviewed_by", input.ActorAccountID),
	)
	return nil
}

// insertContractRequest stores the request and its child. The request names
// no guardian, no address and no account, so no parent finds it in the
// parents portal, and it carries no consent and no legal evidence: no parent
// declared anything. Its status token expires at once: nobody is given it.
func (d *Decisions) insertContractRequest(ctx context.Context, input enrollmentNative.ContractEnrollment, phase *enrollmentNative.Phase,
	person *Person) (*enrollmentNative.Request, *enrollmentNative.RequestChild, error) {
	if d.deps.Random == nil {
		return nil, nil, errors.New("the random source of the status token is required")
	}
	token, err := enrollmentNative.NewStatusToken(d.deps.Random)
	if err != nil {
		return nil, nil, fmt.Errorf("generate status token: %w", err)
	}
	now := d.deps.Now()
	request := &enrollmentNative.Request{
		PhaseID: phase.ID, SchemaID: phase.FormSchemaID, SubmissionSource: enrollmentNative.RequestSourceContractImport,
		SourceMetadata: formValues(map[string]any{"contract_id": input.ContractID}),
		StatusToken:    token, StatusTokenExpires: &now, SubmittedAt: now,
	}
	request.TenantID = d.deps.Runtime.TenantID(ctx)
	if err := d.deps.ContractRecords.InsertRequest(ctx, request); err != nil {
		return nil, nil, fmt.Errorf("create request: %w", err)
	}
	child := &enrollmentNative.RequestChild{RequestID: request.ID, FirstName: person.FirstName, LastName: person.LastName,
		DateOfBirth: *person.Birthday, Status: enrollmentNative.ChildStatusSubmitted}
	child.TenantID = request.TenantID
	if err := d.deps.ContractRecords.InsertChild(ctx, child); err != nil {
		return nil, nil, fmt.Errorf("create request child: %w", err)
	}
	return request, child, nil
}
