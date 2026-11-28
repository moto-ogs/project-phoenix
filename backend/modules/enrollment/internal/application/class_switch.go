package application

import (
	"context"
	"fmt"
	"log/slog"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// planClassSwitch stores the class switch an approval planned for the request
// child, or clears it when change is nil or keeps the class (#3917).
func (d *Decisions) planClassSwitch(ctx context.Context, requestChildID int64, change *enrollmentNative.ClassSwitch) error {
	if change != nil && change.From == change.To {
		change = nil
	}
	if err := d.deps.Children.SetChildClassSwitch(ctx, requestChildID, change); err != nil {
		return fmt.Errorf("decision: plan class switch: %w", err)
	}
	return nil
}

// planClassSwitchKeepingPlace is planClassSwitch for a deferred renewal: a
// child without an OGS place (#4803) keeps a plan that keeps its class, so
// the switch day still grants its place.
func (d *Decisions) planClassSwitchKeepingPlace(ctx context.Context, requestChildID int64, change *enrollmentNative.ClassSwitch, withoutCarePlace bool) error {
	if change == nil || change.From != change.To || !withoutCarePlace {
		return d.planClassSwitch(ctx, requestChildID, change)
	}
	if err := d.deps.Children.SetChildClassSwitch(ctx, requestChildID, change); err != nil {
		return fmt.Errorf("decision: plan class switch: %w", err)
	}
	return nil
}

// replanApprovedChildClass re-derives a still planned class switch after a
// confirmed edit of the approved child. The child keeps its running class;
// only the planned target follows the edit. ok is false when no switch is
// planned for a future day, so the caller writes the class at once.
func (d *Decisions) replanApprovedChildClass(ctx context.Context, run *approvedChildSync) (bool, error) {
	planned, err := d.deps.Children.ChildClassSwitch(ctx, run.child.ID)
	if err != nil {
		return false, fmt.Errorf("decision: read planned class switch: %w", err)
	}
	if planned == nil {
		return false, nil
	}
	// A plan that still owes a child without an OGS place (#4803) its place,
	// held by the Kinderkontingent or not yet applied by the tick, is
	// re-derived like a future one: the tick then writes the edited class
	// together with the place.
	if !calendar.Date(planned.On).After(d.todayDate()) && !run.student.WithoutCarePlace {
		// The switch day has come but the tick has not run yet: the edit
		// writes the class now, which makes the plan obsolete.
		return false, d.planClassSwitch(ctx, run.child.ID, nil)
	}
	current := run.student.SchoolClass
	replanned := &enrollmentNative.ClassSwitch{
		RequestChildID: run.child.ID, From: current, To: resolveRolloverSchoolClass(run.child, current), On: planned.On,
	}
	return true, d.planClassSwitchKeepingPlace(ctx, run.child.ID, replanned, run.student.WithoutCarePlace)
}

// ApplyDueClassSwitches moves the children whose planned class switch is due
// into their new class and clears the plans (#3917). The rollover tick runs it
// in the tenant transaction. A switch applies only while the request child is
// still approved and the child is still enrolled in the class it had at
// approval: a manual class edit or a grade transition in between wins and the
// plan is dropped. Like an approval that changes a class, it takes the
// class-writes and recurrence gates first and resyncs the offering-sourced
// templates from asOf, so the Jahrgang-filtered rosters follow the new class.
func (d *Decisions) ApplyDueClassSwitches(ctx context.Context, asOf calendar.Date) (int, error) {
	// Take the same gates an approved-child sync uses before reading the
	// plans. Otherwise an edit can replace a plan after this worker's read,
	// leaving this run to apply and clear the stale target.
	if err := d.LockApprovalGates(ctx); err != nil {
		return 0, err
	}
	due, err := d.deps.Children.DueClassSwitches(ctx, enrollmentNative.Date(asOf.String()))
	if err != nil {
		return 0, fmt.Errorf("class switch: list due switches: %w", err)
	}
	if len(due) == 0 {
		return 0, nil
	}
	applied := 0
	previousClasses := make(map[int64]string, len(due))
	for _, change := range due {
		outcome, err := d.applyDueClassSwitch(ctx, change)
		if err != nil {
			return applied, err
		}
		if outcome.applied {
			applied++
			previousClasses[*change.CreatedStudentID] = change.From
		}
		// A child without an OGS place stood in no Regeltermin (ADR 0282):
		// with its place it joins those of its class, whatever class it
		// had before (#8279).
		if outcome.grantedPlace {
			previousClasses[*change.CreatedStudentID] = ""
		}
	}
	if applied > 0 {
		if err := d.resyncOfferingSourcedTemplates(ctx, asOf); err != nil {
			return applied, fmt.Errorf("class switch: resync sourced templates: %w", err)
		}
	}
	if err := d.followClassChanges(ctx, previousClasses, asOf); err != nil {
		return applied, fmt.Errorf("class switch: follow class changes on targeted templates: %w", err)
	}
	return applied, nil
}

// applyDueClassSwitch applies one due switch and clears its plan. Only a
// child without an OGS place (#4803) can raise the Kontingentzahl here: its
// place starts with this switch. A full Kinderkontingent holds this one
// switch; the plan stays, so a later run grants the place once one is free,
// and the other switches of the school still apply.
func (d *Decisions) applyDueClassSwitch(ctx context.Context, change enrollmentNative.DueClassSwitch) (classSwitchOutcome, error) {
	var outcome classSwitchOutcome
	_, err := d.inSavepoint(ctx, func(applyCtx context.Context) (bool, error) {
		var err error
		outcome, err = d.applyClassSwitch(applyCtx, change)
		return outcome.applied, err
	})
	if isChildQuotaReached(err) {
		d.logger().Warn("class switch: place held, child quota reached",
			slog.Int64("request_child_id", change.RequestChildID))
		ok, err := d.inSavepoint(ctx, func(applyCtx context.Context) (bool, error) {
			return d.applyClassHoldingPlace(applyCtx, change)
		})
		return classSwitchOutcome{applied: ok}, err
	}
	if err != nil {
		return classSwitchOutcome{}, err
	}
	if err := d.deps.Children.SetChildClassSwitch(ctx, change.RequestChildID, nil); err != nil {
		return classSwitchOutcome{}, fmt.Errorf("class switch: clear request child %d: %w", change.RequestChildID, err)
	}
	return outcome, nil
}

// classSwitchOutcome is what one due switch did: applied, it moved the child
// into its new class; grantedPlace, it gave a child without an OGS place
// (#4803) the place the approval deferred to this day.
type classSwitchOutcome struct {
	applied      bool
	grantedPlace bool
}

// applyClassHoldingPlace applies the class of a switch the Kinderkontingent
// refused: the child without an OGS place moves into its new class on this
// day all the same, and only its place waits. The plan stays, now from the
// new class to itself, so a later run grants the place once one is free.
// A switch the school already overtook keeps its plan as it is.
func (d *Decisions) applyClassHoldingPlace(ctx context.Context, change enrollmentNative.DueClassSwitch) (bool, error) {
	student, err := d.readEnrollmentStudent(ctx, *change.CreatedStudentID, "update")
	if err != nil {
		return false, fmt.Errorf("class switch: load student %d: %w", *change.CreatedStudentID, err)
	}
	if student == nil || !student.WithoutCarePlace || student.SchoolClass != change.From || change.From == change.To {
		return false, nil
	}
	student.SchoolClass = change.To
	input := enrollmentStudentInput(student)
	input.PreserveCarePlaceStatus = true
	if err := d.deps.StudentEnrollment.RenewEnrollmentStudent(ctx, student.ID, input); err != nil {
		return false, fmt.Errorf("class switch: update student %d: %w", student.ID, err)
	}
	held := change.ClassSwitch
	held.From = change.To
	if err := d.planClassSwitchKeepingPlace(ctx, change.RequestChildID, &held, true); err != nil {
		return false, err
	}
	return true, nil
}

// inSavepoint runs one step of a switch in its own savepoint, so a step the
// Kinderkontingent refuses leaves nothing half written behind.
func (d *Decisions) inSavepoint(ctx context.Context, step func(context.Context) (bool, error)) (bool, error) {
	if d.deps.Runtime.InTransaction == nil || !d.deps.Runtime.InTransaction(ctx) {
		return step(ctx)
	}
	var ok bool
	err := d.deps.Runtime.Savepoint(ctx, func(stepCtx context.Context) error {
		var stepErr error
		ok, stepErr = step(stepCtx)
		return stepErr
	})
	return ok, err
}

func (d *Decisions) applyClassSwitch(ctx context.Context, change enrollmentNative.DueClassSwitch) (classSwitchOutcome, error) {
	if change.ChildStatus != enrollmentNative.ChildStatusApproved || change.CreatedStudentID == nil {
		return classSwitchOutcome{}, nil
	}
	student, err := d.readEnrollmentStudent(ctx, *change.CreatedStudentID, "update")
	if err != nil && d.deps.Runtime.NotFound(err) {
		return classSwitchOutcome{}, nil
	}
	if err != nil {
		return classSwitchOutcome{}, fmt.Errorf("class switch: load student %d: %w", *change.CreatedStudentID, err)
	}
	if student == nil || (student.Status != studentStatusActive && student.Status != studentStatusPending) {
		return classSwitchOutcome{}, nil
	}
	granted := classSwitchOutcome{grantedPlace: student.WithoutCarePlace}
	if student.SchoolClass != change.From {
		d.logger().Info("class switch skipped: class changed since approval",
			slog.Int64("request_child_id", change.RequestChildID),
			slog.Int64("student_id", student.ID))
		// A child without an OGS place (#4803) still gets the place the
		// approval deferred to this day; the renewal keeps the school's
		// class. A child with a place has nothing left to apply.
		if !student.WithoutCarePlace {
			return classSwitchOutcome{}, nil
		}
		if err := d.deps.StudentEnrollment.RenewEnrollmentStudent(ctx, student.ID, enrollmentStudentInput(student)); err != nil {
			return classSwitchOutcome{}, fmt.Errorf("class switch: grant place to student %d: %w", student.ID, err)
		}
		return granted, nil
	}
	student.SchoolClass = change.To
	if err := d.deps.StudentEnrollment.RenewEnrollmentStudent(ctx, student.ID, enrollmentStudentInput(student)); err != nil {
		return classSwitchOutcome{}, fmt.Errorf("class switch: update student %d: %w", student.ID, err)
	}
	granted.applied = true
	return granted, nil
}
