package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The writes of the enrollment of the children of imported care contracts
// (#7760, ADR 0309).
//
// Statements. What Enrollment owns is read and written in sets, so its
// statements do not grow with the number of children: the gates, per phase
// its offerings, its applications and the stored bookings the run compares,
// the child records with their persons, then one insert each for the
// requests, the children and the submitted choices and one update for the
// approvals.
//
// The care a child's bookings derive is Care Plan's: it records the bookings
// (RecordCareOfferingBookings), derives the rosters of the approval
// (MaterializeApprovedBookings) and reconciles the rosters with several
// source offerings (ResyncMultiSourceTemplatesForChild), each for one
// application child under that child's booking lock, as every approval calls
// them. These three calls stay per child. They are the roster writer of the
// approval, shared with Decide and the rollover; a set-based form is a
// rewrite of that writer, not a variant of it. The resync of the pickup auto
// excusals is one call for all children, and Care Plan works through it one
// child at a time too: it locks the child record and re-derives each coming
// pickup exception under the lock of its day. Measured with one offering
// linked to one roster and one coming pickup exception that gains an
// excusal: 31 statements per child (3 for the bookings, 9 for the rosters,
// 3 for the multi-source rosters, 16 for the excusals; 2 of the 16 without
// a coming exception), asserted exactly by the query budget
// services.enrollment.contract_enrollments.enroll.

// EnrollContractChildren enrolls each child that can be enrolled and
// confirms each application a row names. It takes the approval gates first,
// then the match lock of each phase in ascending order, before any row lock
// (ADR 0162). A school that derives no care from bookings is refused before
// any of it.
func (d *Decisions) EnrollContractChildren(ctx context.Context, enrollments []enrollmentNative.ContractEnrollment) (publicResult []enrollmentNative.ContractEnrollmentResult, publicErr error) {
	defer func() { publicErr = PublicError(publicErr) }()
	results := make([]enrollmentNative.ContractEnrollmentResult, len(enrollments))
	if err := d.requireContractEnrollments(enrollments); err != nil || len(enrollments) == 0 {
		return results, err
	}
	if off, err := d.refuseWithoutCareOfferings(ctx, enrollments, results); err != nil || off {
		return results, err
	}
	phases, err := d.lockContractPhases(ctx, enrollments)
	if err != nil {
		return nil, err
	}
	run := &contractRun{phases: phases}
	if err := d.readContractStudents(ctx, run, enrollments); err != nil {
		return nil, err
	}
	for i, input := range enrollments {
		run.check(i, input, &results[i])
	}
	if len(run.pending) == 0 {
		return results, nil
	}
	if err := d.enrollContractChildren(ctx, run.pending); err != nil {
		return nil, err
	}
	for _, subject := range run.pending {
		for _, index := range append([]int{subject.index}, subject.repeats...) {
			results[index].RequestID, results[index].RequestChildID = subject.write.Request.ID, subject.write.Child.ID
		}
	}
	return results, nil
}

// enrollContractChildren writes the requests, their approved children and
// the care derived from the bookings, in the order of an approval: the
// requests, the children linked to their child records and the submitted
// choices in sets; per child the bookings and the rosters, which resolve
// the child's student through that link; the approvals in one statement;
// per child the multi-source rosters; and the pickup effects of the staff
// for all children at once.
func (d *Decisions) enrollContractChildren(ctx context.Context, pending []*contractSubject) error {
	stamp := enrollmentNative.ContractEnrollmentStamp{At: d.deps.Now(), Reason: contractEnrollmentReason}
	writes, err := d.contractWrites(ctx, pending, stamp)
	if err != nil {
		return err
	}
	if err := d.deps.PhaseHolders.InsertContractEnrollments(ctx, writes, stamp); err != nil {
		return fmt.Errorf("contract enrollment: create requests: %w", err)
	}
	approvals := make([]enrollmentNative.ContractChildApproval, len(pending))
	students := make([]int64, 0, len(pending))
	for i, subject := range pending {
		subject.write = writes[i]
		approvals[i] = enrollmentNative.ContractChildApproval{RequestChildID: subject.write.Child.ID, ReviewedBy: subject.input.ActorAccountID}
		students = append(students, subject.input.StudentID)
		// Care Plan's per-child calls of an approval (see the file comment).
		if err := d.deps.CareBookings.RecordCareBookings(ctx, subject.write.Child.ID, subject.bookings); err != nil {
			return fmt.Errorf("contract enrollment: student %d: record care bookings: %w", subject.input.StudentID, err)
		}
		if err := d.materializeEnrollmentsForApproval(ctx, subject.write.Child.ID, subject.input.StudentID, subject.careWindow()); err != nil {
			return fmt.Errorf("contract enrollment: student %d: %w", subject.input.StudentID, err)
		}
	}
	if err := d.deps.PhaseHolders.ApproveContractChildren(ctx, approvals, stamp); err != nil {
		return fmt.Errorf("contract enrollment: approve children: %w", err)
	}
	return d.followContractApprovals(ctx, pending, students)
}

// careWindow is the phase of the child as Care Plan derives its rosters
// from it: the phase, starting on the day the child's bookings start. Care
// Plan reads the bookings of an approval on the first day of the window
// and starts the roster rows there. A contract that began after the
// service of the phase books from its first day, so the window starts
// there too: read at the service start, such a child had no booking and
// got no roster, and no row may reach back before the contract. For a
// child booked from the service start it is the phase itself.
func (s *contractSubject) careWindow() *enrollmentNative.Phase {
	window := *s.phase.phase
	if s.careStart.After(calendar.Date(window.ServiceStartDate)) {
		window.ServiceStartDate = enrollmentNative.Date(s.careStart)
	}
	return &window
}

// followContractApprovals runs what follows the approvals: per child the
// rosters with several source offerings, and once for all children the
// pickup auto excusals of the staff, which follow the bookings: a coming
// pickup exception keeps its day, time and reason, and the excusal and the
// staff task derived from the booked end time are derived again.
//
// The announcement of the pickup projection is left out
// (ReconcileOfferingPickupForStudents): it reaches the children's guardians
// in the parents portal. Care Plan makes that announcement and the two
// staff-only ones (the pickup schedule of the school, the hints of the
// manual student plan, #5498) in one call, and has no capability for the
// staff part alone. So staff views open during a run show the new children
// after a reload, not live (ADR 0309).
func (d *Decisions) followContractApprovals(ctx context.Context, pending []*contractSubject, students []int64) error {
	for _, subject := range pending {
		// Care Plan's per-child call of an approval (see the file comment).
		if err := d.resyncMultiSourceTemplatesForChild(ctx, subject.write.Child.ID, subject.careWindow()); err != nil {
			return fmt.Errorf("contract enrollment: student %d: resync multi-source templates: %w", subject.input.StudentID, err)
		}
		d.logger().Info("contract enrollment created",
			slog.Int64("request_id", subject.write.Request.ID),
			slog.Int64("request_child_id", subject.write.Child.ID),
			slog.Int64("student_id", subject.input.StudentID),
			slog.Int64("contract_id", subject.input.ContractID),
			slog.Int64("reviewed_by", subject.input.ActorAccountID),
		)
	}
	if d.deps.Pickups.ResyncExcusal == nil {
		return nil
	}
	slices.Sort(students)
	if err := d.deps.Pickups.ResyncExcusal(ctx, slices.Compact(students)); err != nil {
		return fmt.Errorf("contract enrollment: resync pickup auto excusals: %w", err)
	}
	return nil
}

// contractWrites builds the request, the child and the submitted choices of
// each child to enroll. A request names no guardian, no address and no
// account, so no parent finds it in the parents portal, and it carries no
// consent and no legal evidence: no parent declared anything. Its status
// token expires at once: nobody is given it. The child is linked to its
// child record from the start; it is approved after its rosters exist.
func (d *Decisions) contractWrites(ctx context.Context, pending []*contractSubject, stamp enrollmentNative.ContractEnrollmentStamp) ([]enrollmentNative.ContractEnrollmentWrite, error) {
	if d.deps.Random == nil {
		return nil, errors.New("contract enrollment: the random source of the status token is required")
	}
	tenantID := d.deps.Runtime.TenantID(ctx)
	writes := make([]enrollmentNative.ContractEnrollmentWrite, len(pending))
	for i, subject := range pending {
		token, err := enrollmentNative.NewStatusToken(d.deps.Random)
		if err != nil {
			return nil, fmt.Errorf("contract enrollment: generate status token: %w", err)
		}
		expires, student := stamp.At, subject.input.StudentID
		request := &enrollmentNative.Request{
			PhaseID: subject.phase.phase.ID, SchemaID: subject.phase.phase.FormSchemaID,
			SubmissionSource: enrollmentNative.RequestSourceContractImport,
			SourceMetadata:   formValues(map[string]any{"contract_id": subject.input.ContractID}),
			StatusToken:      token, StatusTokenExpires: &expires, SubmittedAt: stamp.At,
		}
		request.TenantID = tenantID
		child := &enrollmentNative.RequestChild{FirstName: subject.student.FirstName, LastName: subject.student.LastName,
			DateOfBirth: *subject.student.Birthday, Status: enrollmentNative.ChildStatusSubmitted, CreatedStudentID: &student}
		child.TenantID = tenantID
		choices := make([]enrollmentNative.SubmittedOfferingChoice, len(subject.bookings))
		for n, booking := range subject.bookings {
			choices[n] = enrollmentNative.SubmittedOfferingChoice{CareOfferingID: booking.CareOfferingID, SelectedDays: booking.ManualSelectedDays,
				Terms: submittedOfferingTerms(subject.phase.offerings[booking.CareOfferingID])}
		}
		writes[i] = enrollmentNative.ContractEnrollmentWrite{Request: request, Child: child, Choices: choices}
	}
	return writes, nil
}
