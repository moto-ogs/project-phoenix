package timetracking

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A day of the Träger's time export folds its blocks: the first start, the
// last end, breaks plus gaps, the net time. A running block leaves the end
// empty, and an absence names its kind and the school's wording.
func TestTraegerStaffDaysFoldBlocksAndAbsences(t *testing.T) {
	t.Parallel()
	day := calendar.NewDate(2026, time.October, 6)
	at := func(hour, minute int) time.Time {
		return time.Date(2026, time.October, 6, hour, minute, 0, 0, calendar.Berlin)
	}
	end := at(12, 0)
	sessions := []*SessionResponse{
		{WorkSession: &WorkSession{Date: day, CheckInTime: at(8, 0), CheckOutTime: &end}, BreakMinutes: 15, NetMinutes: 225},
		{WorkSession: &WorkSession{Date: day, CheckInTime: at(12, 45)}, NetMinutes: 60},
	}
	absences := []*StaffAbsence{
		{AbsenceType: workforce.AbsenceTypeOther, AbsenceTypeLabel: "Regenerationstag", Status: AbsenceStatusApproved,
			DateStart: calendar.NewDate(2026, time.October, 8), DateEnd: calendar.NewDate(2026, time.October, 8)},
		{AbsenceType: workforce.AbsenceTypeSick, Status: AbsenceStatusDeclined,
			DateStart: calendar.NewDate(2026, time.October, 9), DateEnd: calendar.NewDate(2026, time.October, 9)},
	}

	days := traegerStaffDays(7, sessions, absences)

	assert.Equal(t, []workforce.TraegerTimeDay{
		{StaffID: 7, Date: day, Start: "08:00", BreakMinutes: 60, ActualMinutes: 285},
		{StaffID: 7, Date: calendar.NewDate(2026, time.October, 8), AbsenceKind: workforce.AbsenceTypeOther, AbsenceLabel: "Regenerationstag"},
	}, days)
}

type timeDaysRecorder struct{ ids []int64 }

func (r *timeDaysRecorder) TraegerTimeDays(_ context.Context, ids []int64, _, _ calendar.Date) ([]workforce.TraegerTimeDay, error) {
	r.ids = ids
	return nil, nil
}

// The time export reads no day of an external caregiver: it leaves out the
// people the payroll file leaves out (#3823, #4712).
func TestTraegerTimeDaysLeaveOutExternalCaregivers(t *testing.T) {
	t.Parallel()
	overview := &staffOverviewService{staffRepo: overviewStaffQueryFunc(func(context.Context) ([]OverviewStaff, error) {
		return []OverviewStaff{{ID: 10}, {ID: 11, ExternalCaregiver: true}}, nil
	}), nowFunc: testNow}
	days := &timeDaysRecorder{}
	school := TraegerExportSchool{staff: overview, days: days}
	got, err := school.TraegerTimeDays(context.Background(), workforce.TraegerTimeRequest{
		StaffIDs: []int64{11, 10, 12, 13}, DaysFor: []int64{11, 10, 12},
		From: calendar.NewDate(2026, time.October, 1), To: calendar.NewDate(2026, time.October, 31),
	})
	assert.NoError(t, err)
	assert.Equal(t, []int64{10}, got.Kept, "the caregiver and unknown employments are left out")
	assert.Equal(t, []int64{10}, days.ids)
}
