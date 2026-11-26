package timetracking

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type ownCalendar struct {
	holidays []workforce.OwnTimeHoliday
	closing  []workforce.OwnTimeClosingDay
	daysOff  map[calendar.Date]bool
}

func (c ownCalendar) HolidayDates(context.Context, calendar.Date, calendar.Date) (map[calendar.Date]bool, error) {
	return c.daysOff, nil
}

// Read the same statutory holidays and overlapping school/Träger closures
// as the narrow reads. Keep their names for the table and pass their union
// to the existing Soll resolver; school holiday periods are not closing days.
func readOwnCalendar(ctx context.Context, source workforce.PlanningCalendar, from, to, start, end calendar.Date) (ownCalendar, error) {
	holidays, err := source.HolidaysInRange(ctx, from.String(), to.String())
	if err != nil {
		return ownCalendar{}, fmt.Errorf("own time period: holidays: %w", err)
	}
	closing, err := source.ClosingDaysInRange(ctx, from.String(), to.String())
	if err != nil {
		return ownCalendar{}, fmt.Errorf("own time period: closing days: %w", err)
	}
	result := ownCalendar{
		holidays: make([]workforce.OwnTimeHoliday, 0),
		closing:  make([]workforce.OwnTimeClosingDay, 0),
		daysOff:  make(map[calendar.Date]bool, len(holidays)),
	}
	for _, holiday := range holidays {
		day := calendar.Date(holiday.Date)
		result.daysOff[day] = true
		if !day.Before(start) && !day.After(end) {
			result.holidays = append(result.holidays, workforce.OwnTimeHoliday{Date: day, Name: holiday.Name})
		}
	}
	for _, period := range closing {
		first, last := calendar.Date(period.StartDate), calendar.Date(period.EndDate)
		for day := max(first, from); !day.After(min(last, to)); day = day.AddDays(1) {
			result.daysOff[day] = true
		}
		if !first.After(end) && !last.Before(start) {
			result.closing = append(result.closing, workforce.OwnTimeClosingDay{StartDate: first, EndDate: last, Reason: period.Reason})
		}
	}
	return result, nil
}

func (s ownTimeViews) ownedShifts(ctx context.Context, staffID int64, from, to calendar.Date) ([]workforce.PlannedShift, workforce.OwnTimeShifts, error) {
	var booked bool
	rows, state, err := optionalOwnRead(ctx, s.months.getLogger(), "shifts", func(ctx context.Context) ([]workforce.PlannedShift, error) {
		var err error
		booked, err = s.planning.ShiftsBooked(ctx)
		if err != nil || !booked {
			return nil, err
		}
		return s.planning.Shifts.ListShifts(ctx, workforce.ShiftRange{StaffID: staffID, From: from.String(), To: to.String()})
	})
	result := workforce.OwnTimeShifts{State: state}
	if state != workforce.OwnReadReady {
		return nil, result, err
	}
	if !booked {
		result.State = workforce.OwnReadNotBooked
		return nil, result, nil
	}
	result.Rows = make([]workforce.OwnTimeShift, 0, len(rows))
	for _, row := range rows {
		shift := workforce.OwnTimeShift{
			ID: ident.ID(row.ID), Date: calendar.Date(row.Date), StartTime: ownWallClock(row.StartTime), EndTime: ownWallClock(row.EndTime),
			BreakMinutes: row.BreakMinutes, Cancelled: row.Cancelled, ChangeReason: row.ChangeReason, OriginShiftID: (*ident.ID)(row.OriginShiftID),
		}
		if row.ShiftType != nil {
			shift.ShiftTypeName, shift.ShiftTypeColor = row.ShiftType.Name, row.ShiftType.Color
		}
		result.Rows = append(result.Rows, shift)
	}
	return rows, result, nil
}

func (s ownTimeViews) ownedAssignments(ctx context.Context, staffID int64, day calendar.Date) (workforce.OwnTimeAssignments, error) {
	rows, state, err := optionalOwnRead(ctx, s.months.getLogger(), "assignments", func(ctx context.Context) ([]workforce.StaffAssignment, error) {
		return s.planning.Assignments.ListStaffAssignments(ctx, staffID, day.String(), day.String())
	})
	result := workforce.OwnTimeAssignments{State: state}
	if state == workforce.OwnReadReady {
		result.Rows = make([]workforce.OwnTimeAssignment, 0, len(rows))
		for _, a := range rows {
			result.Rows = append(result.Rows, workforce.OwnTimeAssignment{
				InstanceID: ident.ID(a.InstanceID), Title: a.Title, GroupName: a.GroupName, RoomName: a.RoomName,
				Date: calendar.Date(a.Date), StartTime: ownWallClock(a.StartTime), EndTime: ownWallClock(a.EndTime),
				Status: a.Status, IsSpontaneous: a.IsSpontaneous, Cancelled: a.Cancelled, IsPrimary: a.IsPrimary,
				IsSubstitute: a.IsSubstitute, IsAbsent: a.IsAbsent, AbsenceReason: a.AbsenceReason,
				CancelReason: a.CancelReason, UnderstaffedAck: a.UnderstaffedAck,
			})
		}
	}
	return result, err
}

func ownWallClock(value string) string {
	clock, err := time.Parse(workforce.ClockLayout, value)
	if err != nil {
		return value
	}
	return clock.Format("15:04")
}
