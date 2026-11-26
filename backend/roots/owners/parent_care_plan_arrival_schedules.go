package owners

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	parentportal "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

func NewParentArrivalSchedules(source careplan.ArrivalScheduleService) parentportal.ArrivalSchedules {
	if source == nil {
		return nil
	}
	return parentportal.NewArrivalSchedules(parentportal.ArrivalSchedulesCallbacks{
		GetStudentArrivalExceptionsForDate: func(ctx context.Context, ids []int64, date calendar.Date) (map[int64]*parentportal.ArrivalExceptionSnapshot, error) {
			values, err := source.GetStudentArrivalExceptionsForDate(ctx, ids, date)
			if values == nil {
				return nil, err
			}
			out := make(map[int64]*parentportal.ArrivalExceptionSnapshot, len(values))
			for id, value := range values {
				out[id] = parentCarePlanPointer(value, parentCarePlanFromOwnerArrivalException)
			}
			return out, err
		},
		GetWeeklySchedulesByStudentIDsAndWeekday: func(ctx context.Context, ids []int64, weekday int) ([]*parentportal.ArrivalScheduleSnapshot, error) {
			value, err := source.GetWeeklySchedulesByStudentIDsAndWeekday(ctx, ids, weekday)
			return parentCarePlanSlice(value, func(value *careplan.ArrivalSchedule) *parentportal.ArrivalScheduleSnapshot {
				return parentCarePlanPointer(value, parentCarePlanFromOwnerArrivalSchedule)
			}), err
		},
		GetStudentArrivalSchedules: func(ctx context.Context, id int64) ([]*parentportal.ArrivalScheduleSnapshot, error) {
			value, err := source.GetStudentArrivalSchedules(ctx, id)
			return parentCarePlanSlice(value, func(value *careplan.ArrivalSchedule) *parentportal.ArrivalScheduleSnapshot {
				return parentCarePlanPointer(value, parentCarePlanFromOwnerArrivalSchedule)
			}), err
		},
	})
}
