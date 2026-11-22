package application

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// scheduleAuthor is the author of the weekly rows a dispatch writes: a staff
// member resolved earlier, the Träger-Büro resolved earlier, or else the
// staff membership of the reviewing account.
type scheduleAuthor struct {
	staffID           int64
	byTraeger         bool
	reviewerAccountID int64
}

// resolvedScheduleAuthor names the rows' author: a staff member, or the
// Träger-Büro with staffID 0 (#7818).
type resolvedScheduleAuthor struct {
	staffID   int64
	byTraeger bool
}

// resolveScheduleAuthor resolves who the weekly rows name. A reviewer with a
// staff record of the school always writes as that staff member. A reviewer
// without one writes as the Träger-Büro only in a request the Träger-Büro
// marked; a failed lookup stays a failure and never becomes the Träger-Büro.
func (d *Decisions) resolveScheduleAuthor(ctx context.Context, author scheduleAuthor) (resolvedScheduleAuthor, error) {
	if author.staffID > 0 {
		return resolvedScheduleAuthor{staffID: author.staffID}, nil
	}
	if author.byTraeger {
		return resolvedScheduleAuthor{byTraeger: true}, nil
	}
	staffID, err := d.resolveReviewerStaffID(ctx, author.reviewerAccountID)
	if errors.Is(err, enrollment.ErrDecisionReviewerStaffRequired) && enrollment.TraegerBueroReviewer(ctx) {
		return resolvedScheduleAuthor{byTraeger: true}, nil
	}
	if err != nil {
		return resolvedScheduleAuthor{}, err
	}
	return resolvedScheduleAuthor{staffID: staffID}, nil
}

// dispatchWeekdaySchedule inserts one pickup or arrival schedule row per
// non-empty weekday entry. isPickup=true targets the pickup schedules,
// false the arrival schedules; an unbound schedule port is a no-op.
func (d *Decisions) dispatchWeekdaySchedule(ctx context.Context, raw any, studentID int64, author scheduleAuthor, isPickup bool) error {
	if (isPickup && d.deps.PickupSchedules == nil) || (!isPickup && d.deps.ArrivalSchedules == nil) {
		return nil
	}
	rows, err := weekdayScheduleRows(raw)
	if err != nil {
		return err
	}
	// An answer needs its author even when it names no time: under a
	// replacing dispatch it has already cleared the running rows.
	rowAuthor, err := d.resolveScheduleAuthor(ctx, author)
	if err != nil {
		return err
	}
	for day, hhmm := range rows {
		if err := d.writeWeekdaySchedule(ctx, studentID, day, hhmm, rowAuthor, isPickup); err != nil {
			return err
		}
	}
	return nil
}

// weekdayScheduleRows is the rows a weekly pickup or arrival answer writes:
// its weekdays with a time. A weekday left empty writes nothing.
func weekdayScheduleRows(raw any) (map[string]string, error) {
	var sched enrollment.WeekdaySchedule
	if err := decodeStructured(raw, &sched); err != nil {
		return nil, fmt.Errorf("decode weekday_schedule: %w", err)
	}
	if err := sched.Validate(); err != nil {
		return nil, fmt.Errorf("%w: %w", enrollment.ErrDecisionInvalidData, err)
	}
	rows := make(map[string]string, len(sched))
	for day, hhmm := range sched {
		if hhmm = strings.TrimSpace(hhmm); hhmm != "" {
			rows[day] = hhmm
		}
	}
	return rows, nil
}

func (d *Decisions) writeWeekdaySchedule(ctx context.Context, studentID int64, day, hhmm string, author resolvedScheduleAuthor, isPickup bool) error {
	if !isPickup {
		if err := d.deps.ArrivalSchedules.CreateArrivalSchedule(ctx, studentID, offeringContract.DayNumber(day), author.staffID, author.byTraeger); err != nil {
			return fmt.Errorf("create arrival %s: %w", day, err)
		}
		return nil
	}
	t, err := time.Parse("15:04", hhmm)
	if err != nil {
		return fmt.Errorf("parse %s time %q: %w", day, hhmm, err)
	}
	if err := d.deps.PickupSchedules.UpsertPickupSchedule(ctx, studentID, offeringContract.DayNumber(day), calendar.NormalizeWallClock(t), author.staffID, author.byTraeger); err != nil {
		return fmt.Errorf("upsert pickup %s: %w", day, err)
	}
	return nil
}

// resolveReviewerStaffID returns the staff id of the reviewing account, the
// author of the schedule rows the approval writes.
func (d *Decisions) resolveReviewerStaffID(ctx context.Context, reviewerAccountID int64) (int64, error) {
	if reviewerAccountID <= 0 {
		return 0, fmt.Errorf("reviewer account id is required")
	}
	people := d.deps.People
	if people.Persons == nil || people.Staff == nil {
		return 0, fmt.Errorf("reviewer staff lookup is unavailable")
	}
	person, err := people.Persons.PersonByAccount(ctx, reviewerAccountID)
	if err != nil {
		return 0, fmt.Errorf("find reviewer person: %w", err)
	}
	if person == nil {
		return 0, fmt.Errorf("%w: reviewer account %d has no linked person", enrollment.ErrDecisionReviewerStaffRequired, reviewerAccountID)
	}
	staffID, err := people.Staff.StaffIDByPerson(ctx, person.ID)
	if err != nil {
		if d.deps.Runtime.NotFound(err) {
			return 0, fmt.Errorf("%w: reviewer account %d has no linked staff", enrollment.ErrDecisionReviewerStaffRequired, reviewerAccountID)
		}
		return 0, fmt.Errorf("find reviewer staff: %w", err)
	}
	if staffID <= 0 {
		return 0, fmt.Errorf("%w: reviewer account %d has no linked staff", enrollment.ErrDecisionReviewerStaffRequired, reviewerAccountID)
	}
	return staffID, nil
}

// An approved weekly Gehzeit plan changes the same pickup baseline a staff
// weekly edit does. These hooks take the student lock first, compare the
// plan before and after, and re-derive the coupled auto excusals in the
// caller's transaction. They are nil-safe for focused tests.

func (d *Decisions) lockPickupStudents(ctx context.Context, studentIDs []int64) error {
	if d.deps.Pickups.LockStudents == nil || len(studentIDs) == 0 {
		return nil
	}
	if err := d.deps.Pickups.LockStudents(ctx, studentIDs); err != nil {
		return fmt.Errorf("lock students for pickup reset: %w", err)
	}
	return nil
}

func (d *Decisions) resyncPickupAutoExcusals(ctx context.Context, studentIDs []int64) error {
	if d.deps.Pickups.ResyncExcusal == nil || len(studentIDs) == 0 {
		return nil
	}
	if err := d.deps.Pickups.ResyncExcusal(ctx, studentIDs); err != nil {
		return fmt.Errorf("resync pickup auto excusals: %w", err)
	}
	return nil
}

func (d *Decisions) snapshotPickupWeekdayChanges(ctx context.Context, studentID int64, date calendar.Date) (map[int]string, error) {
	if d.deps.Pickups.Snapshot == nil {
		return nil, nil
	}
	before, err := d.deps.Pickups.Snapshot(ctx, studentID, date)
	if err != nil {
		return nil, fmt.Errorf("snapshot pickup weekday changes: %w", err)
	}
	return before, nil
}

func (d *Decisions) recordPickupWeekdayChanges(ctx context.Context, studentID int64, date calendar.Date, before map[int]string) error {
	if d.deps.Pickups.RecordChanges == nil || before == nil {
		return nil
	}
	if err := d.deps.Pickups.RecordChanges(ctx, studentID, date, before); err != nil {
		return fmt.Errorf("record pickup weekday changes: %w", err)
	}
	return nil
}
