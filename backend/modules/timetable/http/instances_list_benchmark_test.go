package timetablehttp

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Measure attendance projection only, without database, conflict detection or
// JSON encoding. Each day contains twelve blocks with 24 assigned children.
func BenchmarkPlannerAttendance(b *testing.B) {
	first := calendar.NewDate(2026, 11, 2)
	checkIn := time.Date(2026, 11, 2, 13, 5, 0, 0, time.UTC)
	rows := make([]timetable.ScheduledParticipant, 24)
	cutoffs := make(map[int64]time.Time)
	for i := range rows {
		id := int64(i + 1)
		rows[i] = timetable.ScheduledParticipant{StudentID: id, Status: timetable.SlotAttendanceExpected}
		if i%2 == 0 {
			rows[i].Status, rows[i].CheckedInAt = timetable.SlotAttendancePresent, &checkIn
		} else {
			cutoffs[id] = calendar.NormalizeWallClock(checkIn.Add(45 * time.Minute))
		}
	}
	for _, tc := range []struct {
		name string
		days int
	}{{"week", 7}, {"month", 30}, {"detail", 1}} {
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				for day := range tc.days {
					inst := timetable.ScheduledInstance{Date: first.AddDays(day), StartTime: calendar.NormalizeWallClock(checkIn), EndTime: calendar.NormalizeWallClock(checkIn.Add(time.Hour))}
					if tc.name == "detail" {
						instanceAttendanceDetails(inst, rows, nil, cutoffs)
						continue
					}
					for range 12 {
						summarizeInstanceStudents(inst, rows, nil, cutoffs, timetable.PlannerGrid)
					}
				}
			}
		})
	}
}
