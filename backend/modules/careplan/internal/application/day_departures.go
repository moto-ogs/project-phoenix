package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func (s *pickupScheduleService) GetBulkDayDepartureModesForDate(ctx context.Context, studentIDs []int64, date calendar.Date) (map[int64]string, error) {
	out := make(map[int64]string)
	ids := uniquePickupStudents(studentIDs)
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.departures.ListDepartureExceptions(ctx, careplan.StudentScheduleFilter{StudentIDs: ids, Date: careplan.Date(date)})
	if err != nil {
		return nil, &careplan.ScheduleError{Op: "list day departures", Err: err}
	}
	for _, row := range rows {
		out[row.StudentID] = row.DepartureMode
	}
	return out, nil
}

// GetBulkEffectivePickupDaysForDate adds the day Abholart to the effective
// Gehzeit (#3946), so a Kinderkarte can mark a one-day change of either. A
// child without an effective Gehzeit is not expected that day and gets no
// entry, whatever its Abholart.
func (s *pickupScheduleService) GetBulkEffectivePickupDaysForDate(ctx context.Context, studentIDs []int64, date calendar.Date) (map[int64]*careplan.EffectivePickupTime, error) {
	effective, err := s.GetBulkEffectivePickupTimesForDate(ctx, studentIDs, date)
	if err != nil {
		return nil, err
	}
	modes, err := s.GetBulkDayDepartureModesForDate(ctx, studentIDs, date)
	if err != nil {
		return nil, err
	}
	for studentID, pickup := range effective {
		if pickup != nil {
			pickup.DayDepartureMode = modes[studentID]
		}
	}
	return effective, nil
}

func (s *pickupScheduleService) SetDayDeparture(ctx context.Context, studentID int64, date calendar.Date, mode string, reason *string, staffID int64) (*careplan.DepartureException, error) {
	careDay, err := calendar.IsCareWeekday(ctx, date)
	if err != nil {
		return nil, &careplan.ScheduleError{Op: "set day departure", Err: err}
	}
	if !careDay {
		return nil, &careplan.ScheduleError{Op: "set day departure", Err: careplan.ErrDepartureExceptionNotCareDay}
	}
	var saved careplan.DepartureException
	err = s.tx.WithinTenant(ctx, func(txCtx context.Context) error {
		if err := s.tx.LockStudentAndExceptionDay(txCtx, studentID, date.String()); err != nil {
			return err
		}
		var err error
		saved, err = s.departures.SaveDepartureException(txCtx, careplan.DepartureException{
			StudentID: studentID, ExceptionDate: careplan.Date(date), DepartureMode: mode, Reason: reason,
			CreatedBy: optionalStaff(staffID), EnteredByTraeger: careplan.EnteredByTraeger(txCtx, staffID),
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func (s *pickupScheduleService) DeleteDayDeparture(ctx context.Context, studentID int64, date calendar.Date) (bool, error) {
	deleted := false
	err := s.tx.WithinTenant(ctx, func(txCtx context.Context) error {
		if err := s.tx.LockStudentAndExceptionDay(txCtx, studentID, date.String()); err != nil {
			return err
		}
		rows, err := s.departures.ListDepartureExceptions(txCtx, careplan.StudentScheduleFilter{StudentIDs: []int64{studentID}, Date: careplan.Date(date)})
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := s.departures.DeleteDepartureException(txCtx, row.ID); err != nil {
				return err
			}
			deleted = true
		}
		return nil
	})
	return deleted, err
}
