package application

import (
	"context"
	"errors"
	"fmt"
	"maps"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// The author of a planned weekly plan (#7818). Only the weekly pickup and
// arrival answers name an author, so only a plan that carries one needs it.
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

// weeklyPlanNeedsAuthor reports whether the plan carries a weekly pickup or
// arrival answer. The dispatch names an author for every such answer, also
// for one without a time, so storing the plan and applying it agree.
func weeklyPlanNeedsAuthor(request *enrollmentNative.Request, child *enrollmentNative.RequestChild, fields []enrollmentNative.FormField) bool {
	for i := range fields {
		if isWeeklyScheduleTarget(fields[i].Target) && readFieldValue(request, child, &fields[i]) != nil {
			return true
		}
	}
	return false
}

// isWeeklyScheduleTarget reports the two targets whose rows name an author.
func isWeeklyScheduleTarget(target string) bool {
	return target == enrollmentNative.TargetSchedulePickup || target == enrollmentNative.TargetScheduleArrival
}

// plannedWeeklyPlanAuthor is the author an approval stores with the plan it
// defers: none for a plan without a weekly answer, else the reviewer's staff
// membership or the Träger-Büro. Anything else fails the approval.
func (d *Decisions) plannedWeeklyPlanAuthor(ctx context.Context, request *enrollmentNative.Request, child *enrollmentNative.RequestChild, reviewedBy int64) (resolvedScheduleAuthor, error) {
	fields, err := d.weeklyPlanSchemaFields(ctx, request)
	if err != nil || !weeklyPlanNeedsAuthor(request, child, fields) {
		return resolvedScheduleAuthor{}, err
	}
	return d.resolveScheduleAuthor(ctx, scheduleAuthor{reviewerAccountID: reviewedBy})
}

// editedWeeklyPlanAuthor names the author of a planned weekly plan after a
// confirmed edit. An actor with an author of their own becomes the author.
// An actor without one keeps the stored author only while the weekly rows
// stay as approved; changing them is refused, so that the start never writes
// new rows in the name of an earlier reviewer.
func (d *Decisions) editedWeeklyPlanAuthor(ctx context.Context, run *approvedChildSync, plan enrollmentNative.WeeklyPlan) (enrollmentNative.WeeklyPlan, error) {
	fields, err := d.weeklyPlanSchemaFields(ctx, run.request)
	if err != nil {
		return plan, err
	}
	if !weeklyPlanNeedsAuthor(run.request, run.child, fields) {
		return plan, nil
	}
	author, err := d.resolveScheduleAuthor(ctx, scheduleAuthor{reviewerAccountID: run.input.ActorAccountID})
	if errors.Is(err, enrollmentNative.ErrDecisionReviewerStaffRequired) && !weeklyRowsChanged(run, fields) {
		return plan, nil
	}
	if err != nil {
		return plan, err
	}
	plan.AuthorStaffID, plan.ByTraeger = author.staffID, author.byTraeger
	return plan, nil
}

// weeklyRowsChanged reports whether the edit changes a weekly pickup or
// arrival row against the snapshot it was made on: the rows, not the raw
// answers, so a weekday added without a time changes nothing. An edit
// without a snapshot (a direct correction of master data) changes no form
// answer unless it says so.
func weeklyRowsChanged(run *approvedChildSync, fields []enrollmentNative.FormField) bool {
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
		if !isWeeklyScheduleTarget(field.Target) {
			continue
		}
		previous := previousRequestData[field.Key]
		if field.AppliesToCh {
			previous = previousChildData[field.Key]
		}
		before, beforeErr := weekdayScheduleRows(previous)
		after, afterErr := weekdayScheduleRows(readFieldValue(run.request, run.child, field))
		if beforeErr != nil || afterErr != nil || !sameWeeklyRows(field.Target, before, after) {
			return true
		}
	}
	return false
}

// sameWeeklyRows compares what two answers write. An arrival row holds its
// weekday only, so its time changes nothing.
func sameWeeklyRows(target string, before, after map[string]string) bool {
	if target == enrollmentNative.TargetSchedulePickup {
		return maps.Equal(before, after)
	}
	return maps.EqualFunc(before, after, func(string, string) bool { return true })
}
