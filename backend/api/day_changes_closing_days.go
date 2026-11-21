package api

// The Schule source of "Heute anders" for the closing days (ADR 0299,
// #7664). The owner is School Calendar: its read of the school's calendar
// returns the school's own closing days and those of its current Träger
// (ADR 0194), in one statement. This binding applies the rule of the existing
// read paths of the closing days in the staff portal and translates them into
// the projection's vocabulary.

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dayChangesClosingDayReads is School Calendar's read of the closing days.
type dayChangesClosingDayReads interface {
	ListClosingDays(ctx context.Context, filter schoolcalendar.ClosingDayFilter) ([]schoolcalendar.ClosingDay, error)
}

// dayChangesClosingDays is the closing day source.
type dayChangesClosingDays struct{ reads dayChangesClosingDayReads }

func (s dayChangesClosingDays) ClosingDays(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	admin := securityruntime.HasAdminWildcard(granted)
	if !admin && !mayReadClosingDays(granted) {
		// The account reads the closing days nowhere: no entries, not a failure.
		return nil, nil
	}
	days, err := s.reads.ListClosingDays(ctx, schoolcalendar.ClosingDayFilter{OverlappingFrom: day.String(), OverlappingTo: day.String()})
	if err != nil {
		return nil, fmt.Errorf("list closing days: %w", err)
	}
	var link *daychangesview.Link
	if admin || securityruntime.HasPermission(permissions.SchedulesManage, granted) {
		link = &daychangesview.Link{Target: daychangesview.LinkCalendarPeriods}
	}
	entries := make([]daychangesview.SourceEntry, 0, len(days))
	for _, closing := range days {
		since, until := closingDaySpan(closing, day)
		entries = append(entries, daychangesview.SourceEntry{
			Kind: daychangesview.KindClosingDay, Since: since, Until: until, Link: link,
			Closing: &daychangesview.DayClosing{Name: closing.Reason, Traeger: closing.Traeger},
		})
	}
	return entries, nil
}

// mayReadClosingDays mirrors the staff portal's reads of the closing days:
// the timetable's list (schedules:read, the planners) and the one of the time
// tracking (time_tracking:own or time_tracking:manage, every staff member who
// records time).
func mayReadClosingDays(granted []string) bool {
	for _, permission := range []string{
		permissions.SchedulesRead, permissions.SchedulesManage,
		permissions.TimeTrackingOwn, permissions.TimeTrackingManage,
	} {
		if securityruntime.HasPermission(permission, granted) {
			return true
		}
	}
	return false
}

// closingDaySpan keeps "seit" and "bis" only where the closing reaches past
// the day. School Calendar stores the days as text; they become calendar
// days here.
func closingDaySpan(closing schoolcalendar.ClosingDay, day calendar.Date) (since, until *calendar.Date) {
	if first, err := calendar.ParseDate(closing.StartDate); err == nil && first.Before(day) {
		since = &first
	}
	if last, err := calendar.ParseDate(closing.EndDate); err == nil && last.After(day) {
		until = &last
	}
	return since, until
}
