package application

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A change to the Stundenplan of a class (#7142) tells the people of the
// class: the weekly Unterrichtsschluss when a weekday's time really changes,
// and a class-wide change on one day when it is set, changed or taken back.
// The notice is written in the transaction of the change; a save that
// changes nothing tells nobody.

// classTimetablePushDays is how far ahead a change may push at all (#7127);
// classTimetableSoonDays how far it pushes by default.
const (
	classTimetablePushDays = 14
	classTimetableSoonDays = 2
)

// classTimetablePush is the push reach of a change on day, seen from today;
// false for a day already past.
func classTimetablePush(today, day calendar.Date) (string, bool) {
	lead := today.DaysUntil(day)
	switch {
	case lead < 0:
		return "", false
	case lead < classTimetableSoonDays:
		return careplan.ClassTimetablePushSoon, true
	case lead <= classTimetablePushDays:
		return careplan.ClassTimetablePushAhead, true
	default:
		return careplan.ClassTimetablePushNone, true
	}
}

// notifyClassTimetable hands one change to the notices; without notices
// nobody is told.
func (s *arrivalScheduleService) notifyClassTimetable(ctx context.Context, notice careplan.ClassTimetableNotice) error {
	if s.notices == nil {
		return nil
	}
	push, ok := classTimetablePush(s.today(), notice.Day)
	if !ok {
		return nil
	}
	notice.Push = push
	if err := s.notices.NotifyClassTimetableChanged(ctx, notice); err != nil {
		return fmt.Errorf("class timetable notice for %s: %w", notice.SchoolClass, err)
	}
	return nil
}

// weeklyClassTimetableNotice is the notice of a weekly save: the weekdays
// whose time differs from before, with the first day ahead they take effect
// on. It reports false when no time changed.
func weeklyClassTimetableNotice(schoolClass string, before, after map[string]string, today calendar.Date) (careplan.ClassTimetableNotice, bool) {
	notice := careplan.ClassTimetableNotice{Kind: careplan.ClassTimetableWeekly, SchoolClass: schoolClass}
	for weekday := 1; weekday <= 5; weekday++ {
		key, _ := domain.ArrivalWeekdayKey(weekday)
		if before[key] == after[key] {
			continue
		}
		notice.Weekdays = append(notice.Weekdays, careplan.ClassTimetableWeekday{Weekday: weekday, Time: after[key]})
		day := nextWeekday(today, time.Weekday(weekday))
		if notice.Day == "" || day.Before(notice.Day) {
			notice.Day = day
		}
	}
	return notice, len(notice.Weekdays) > 0
}

// nextWeekday is the first day from today on that falls on weekday.
func nextWeekday(today calendar.Date, weekday time.Weekday) calendar.Date {
	return today.AddDays((int(weekday) - int(today.Weekday()) + 7) % 7)
}

// normalizedClassTimes is the comparable form of a class row's times; an
// unreadable stored value compares as it is.
func normalizedClassTimes(times map[string]string) map[string]string {
	normalized, err := domain.NormalizeClassArrivalTimes(times)
	if err != nil {
		return times
	}
	return normalized
}

// UpsertClassArrivalException stores the class-wide change of one day and
// tells the people of the class when the time is new or different.
func (s *arrivalScheduleService) UpsertClassArrivalException(ctx context.Context, input careplan.ClassArrivalExceptionInput, createdBy int64) (*careplan.ClassArrivalException, error) {
	if s.notices == nil {
		return s.ClassArrivalExceptions.UpsertClassArrivalException(ctx, input, createdBy)
	}
	var row *careplan.ClassArrivalException
	err := s.tx.WithinTenant(ctx, func(txCtx context.Context) error {
		before, err := s.ListClassArrivalExceptions(txCtx, input.SchoolClass, input.Date, input.Date)
		if err != nil {
			return err
		}
		if row, err = s.ClassArrivalExceptions.UpsertClassArrivalException(txCtx, input, createdBy); err != nil {
			return err
		}
		arrival := row.ArrivalTime.Format("15:04")
		if len(before) > 0 && before[0] != nil && before[0].ArrivalTime.Format("15:04") == arrival {
			return nil
		}
		return s.notifyClassTimetable(txCtx, careplan.ClassTimetableNotice{
			Kind: careplan.ClassTimetableDay, SchoolClass: row.SchoolClass, Day: row.Date, ArrivalTime: arrival,
		})
	})
	if err != nil {
		return nil, err
	}
	return row, nil
}

// DeleteClassArrivalException takes the class-wide change of one day back
// and tells the people of the class that the weekly time applies again.
func (s *arrivalScheduleService) DeleteClassArrivalException(ctx context.Context, schoolClass string, date calendar.Date) error {
	if s.notices == nil {
		return s.ClassArrivalExceptions.DeleteClassArrivalException(ctx, schoolClass, date)
	}
	return s.tx.WithinTenant(ctx, func(txCtx context.Context) error {
		if err := s.ClassArrivalExceptions.DeleteClassArrivalException(txCtx, schoolClass, date); err != nil {
			return err
		}
		return s.notifyClassTimetable(txCtx, careplan.ClassTimetableNotice{
			Kind: careplan.ClassTimetableDayRemoved, SchoolClass: strings.TrimSpace(schoolClass), Day: date,
		})
	})
}
