package application

import (
	"context"
	"errors"
	"fmt"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// The author of a planned weekly plan (#7818). Only the weekly pickup and
// arrival rows name an author, so only a plan that writes them needs one.
// Such a plan is stored with the staff member who approved or changed it, or
// with the mark of the Träger-Büro; a reviewer with neither is refused as at
// an approval that writes the rows at once, and a failed lookup is a failure.
// The stored author only stands for the answers it approved: whoever changes
// the weekly answers later needs an author of their own.

// weeklyPlanSchemaFields is the pinned form of request; nil without one.
func (d *Decisions) weeklyPlanSchemaFields(ctx context.Context, request *enrollmentNative.Request) ([]enrollmentNative.FormField, error) {
	if d.deps.Schemas == nil || request.SchemaID == nil {
		return nil, nil
	}
	schema, err := d.deps.Schemas.Schema(ctx, *request.SchemaID)
	if err != nil {
		return nil, fmt.Errorf("decision: load pinned schema for weekly plan author: %w", err)
	}
	if schema == nil {
		return nil, fmt.Errorf("%w: %d", enrollmentNative.ErrFormSchemaNotFound, *request.SchemaID)
	}
	return schema.Fields, nil
}

// weeklyPlanWritesRows reports whether the plan writes weekly pickup or
// arrival rows, the only part of it that names an author.
func weeklyPlanWritesRows(request *enrollmentNative.Request, child *enrollmentNative.RequestChild, fields []enrollmentNative.FormField) bool {
	for i := range fields {
		field := &fields[i]
		if field.Target != enrollmentNative.TargetSchedulePickup && field.Target != enrollmentNative.TargetScheduleArrival {
			continue
		}
		if targetedFieldHasMeaningfulValue(field.Target, readFieldValue(request, child, field)) {
			return true
		}
	}
	return false
}

// plannedWeeklyPlanAuthor is the author an approval stores with the plan it
// defers: none for a plan without weekly rows, else the reviewer's staff
// membership or the Träger-Büro. Anything else fails the approval.
func (d *Decisions) plannedWeeklyPlanAuthor(ctx context.Context, request *enrollmentNative.Request, child *enrollmentNative.RequestChild, reviewedBy int64) (resolvedScheduleAuthor, error) {
	fields, err := d.weeklyPlanSchemaFields(ctx, request)
	if err != nil || !weeklyPlanWritesRows(request, child, fields) {
		return resolvedScheduleAuthor{}, err
	}
	return d.resolveScheduleAuthor(ctx, scheduleAuthor{reviewerAccountID: reviewedBy})
}

// editedWeeklyPlanAuthor names the author of a planned weekly plan after a
// confirmed edit. An actor with an author of their own becomes the author.
// An actor without one keeps the stored author only while the weekly answers
// stay as approved; changing them is refused, so that the start never writes
// new answers in the name of an earlier reviewer.
func (d *Decisions) editedWeeklyPlanAuthor(ctx context.Context, run *approvedChildSync, plan enrollmentNative.WeeklyPlan) (enrollmentNative.WeeklyPlan, error) {
	fields, err := d.weeklyPlanSchemaFields(ctx, run.request)
	if err != nil {
		return plan, err
	}
	if !weeklyPlanWritesRows(run.request, run.child, fields) {
		return plan, nil
	}
	author, err := d.resolveScheduleAuthor(ctx, scheduleAuthor{reviewerAccountID: run.input.ActorAccountID})
	if errors.Is(err, enrollmentNative.ErrDecisionReviewerStaffRequired) && !weeklyAnswersChanged(run, fields) {
		return plan, nil
	}
	if err != nil {
		return plan, err
	}
	plan.AuthorStaffID, plan.ByTraeger = author.staffID, author.byTraeger
	return plan, nil
}

// weeklyAnswersChanged reports whether the edit changes an answer of the
// weekly plan against the snapshot it was made on. An edit without a
// snapshot (a direct correction of master data) changes no form answer
// unless it says so.
func weeklyAnswersChanged(run *approvedChildSync, fields []enrollmentNative.FormField) bool {
	if run.snapshot == nil {
		return run.input.ChildDataChanged
	}
	previousChild := snapshotChildByID(run.snapshot, run.child.ID)
	if previousChild == nil {
		return true
	}
	previousRequestData := mapFromAny(run.snapshot["custom_data"])
	previousChildData := mapFromAny(previousChild["custom_data"])
	for i := range fields {
		field := &fields[i]
		if !isWeeklyPlanTarget(field.Target) {
			continue
		}
		previous := previousRequestData[field.Key]
		if field.AppliesToCh {
			previous = previousChildData[field.Key]
		}
		if !jsonEqual(previous, readFieldValue(run.request, run.child, field)) {
			return true
		}
	}
	return false
}
