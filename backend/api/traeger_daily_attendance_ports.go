package api

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// traegerDailyAttendancePorts binds the daily attendance report of
// Mecklenburg-Vorpommern (#4717) to the care days of Student Presence, the
// status days of Care Plan and the federal states School Calendar reads for
// the Träger's schools (#4702).
func traegerDailyAttendancePorts(days studentpresence.DailyAttendance, absences careplan.SickStudents, schools traegercalendar.Schools) traegerview.DailyAttendancePorts {
	return traegerview.DailyAttendancePorts{
		Days: traegerChildDays{days: days}, Absences: traegerAbsenceDays{absences: absences}, States: traegerSchoolStates{schools: schools},
	}
}

type traegerChildDays struct {
	days studentpresence.DailyAttendance
}

func (c traegerChildDays) ChildDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]traegerview.ChildDay, error) {
	rows, err := c.days.DailyAttendanceByTenant(ctx, schools, from, to)
	if err != nil {
		return nil, err
	}
	result := make([]traegerview.ChildDay, len(rows))
	for i, row := range rows {
		result[i] = traegerview.ChildDay{SchoolID: row.SchoolID, Date: row.Date, StudentID: row.StudentID, ArrivedAt: row.ArrivedAt, LeftAt: row.LeftAt}
	}
	return result, nil
}

// traegerAbsenceStatus translates Care Plan's statuses into the report's.
var traegerAbsenceStatus = map[string]string{
	careplan.StatusDaySick:      traegerview.AttendanceSick,
	careplan.StatusDayExcused:   traegerview.AttendanceExcused,
	careplan.StatusDayClassTrip: traegerview.AttendanceClassTrip,
}

type traegerAbsenceDays struct {
	absences careplan.SickStudents
}

func (a traegerAbsenceDays) AbsenceDaysByTenant(ctx context.Context, schools []int64, from, to calendar.Date) ([]traegerview.AbsenceDay, error) {
	rows, err := a.absences.StatusDaysByTenant(ctx, schools, from, to)
	if err != nil {
		return nil, err
	}
	result := make([]traegerview.AbsenceDay, 0, len(rows))
	for _, row := range rows {
		if status, ok := traegerAbsenceStatus[row.Status]; ok {
			result = append(result, traegerview.AbsenceDay{SchoolID: row.SchoolID, Date: row.Date, StudentID: row.StudentID, Status: status})
		}
	}
	return result, nil
}

type traegerSchoolStates struct {
	schools traegercalendar.Schools
}

func (s traegerSchoolStates) TraegerSchoolStates(ctx context.Context, organizationID int64) (map[int64]string, error) {
	schools, err := s.schools.TraegerSchools(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	states := make(map[int64]string, len(schools))
	for _, school := range schools {
		states[school.ID] = school.FederalState
	}
	return states, nil
}
