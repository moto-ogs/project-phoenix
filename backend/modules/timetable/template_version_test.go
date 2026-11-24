package timetable_test

import (
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/stretchr/testify/assert"
)

// TestTemplateSeriesVersionKeepsTheTokensHandedOut pins the tokens the
// editor's read answered while the HTTP adapter built them from its response
// shape. The owner took the canonical form over unchanged: an editor opened
// before the release saves without a refusal. The fixtures cover a series
// with and without a planning period, with and without weekday rows,
// unsorted schedules and rosters, and a segment that is gone.
func TestTemplateSeriesVersionKeepsTheTokensHandedOut(t *testing.T) {
	t.Parallel()
	i64 := func(v int64) *int64 { return &v }
	text := func(v string) *string { return &v }
	grade := int16(3)
	base := timetable.TemplateListRow{
		TemplateID: 41, Name: "Randstunde", Type: "care", CategoryID: 7, CategoryName: "x", PlanningTrackID: i64(3),
		RoomID: i64(9), RoomName: text("Raum"), IsOpen: true, MaxParticipants: 12, RequiredStaff: i64(2),
		TargetGroupType: "school_class", TargetSchoolClass: text("2c"), ListKind: text("hand"), Notes: text("n"),
		IncludeClosingDays: true, ManualRosterConfirmed: true, SeriesLastDay: text("2030-07-01"),
		EnrollmentCount: 5, StudentIDs: []int64{30, 10, 20}, StaffIDs: []int64{5, 4}, PrimaryStaffID: i64(4),
		StartTime: text("07:00"), EndTime: text("08:00"), WeekPattern: 1,
	}
	entry := func(row timetable.TemplateListRow, scheduleID int64, weekday int, validFrom *string) timetable.TemplateListEntry {
		row.ScheduleID, row.Weekday, row.ScheduleValidFrom = scheduleID, weekday, validFrom
		return timetable.TemplateListEntry{
			TemplateListRow: row,
			Targets: []timetable.GroupTarget{
				{TargetGroupType: "school_class", TargetSchoolClass: text("2c")},
				{TargetGroupType: "grade", TargetGradeLevel: &grade, EducationGroupID: i64(8)},
			},
			SourceCareOfferingIDs: []int64{77}, SourceGradeLevels: []int{2},
		}
	}
	roster := []timetable.TemplateWeekdayRosterRow{
		{TemplateID: 41, Weekday: 1, Kind: timetable.TemplateWeekdayRosterKindStaff, PersonID: 4, IsPrimary: true},
		{TemplateID: 41, Weekday: 1, Kind: timetable.TemplateWeekdayRosterKindStaff, PersonID: 5},
		{TemplateID: 41, Weekday: 1, Kind: timetable.TemplateWeekdayRosterKindStudent, PersonID: 10},
		{TemplateID: 41, Weekday: 2, Kind: timetable.TemplateWeekdayRosterKindEmpty},
		{TemplateID: 41, Weekday: 3, Kind: timetable.TemplateWeekdayRosterKindProtectedStudent, PersonID: 20},
		{TemplateID: 41, Weekday: 3, Kind: timetable.TemplateWeekdayRosterKindProtectedStudent, PersonID: 30},
	}
	inPeriod := base
	inPeriod.TemplateCalendarPeriodID = i64(55)
	bare := timetable.TemplateListRow{TemplateID: 42, Name: "Leer", Type: "activity", CategoryID: 1}
	for name, tc := range map[string]struct {
		entries []timetable.TemplateListEntry
		roster  []timetable.TemplateWeekdayRosterRow
		want    string
	}{
		"without period": {
			[]timetable.TemplateListEntry{entry(base, 902, 3, text("2030-03-04")), entry(base, 901, 1, nil)}, roster,
			"14f612244a251b910fda0fd9e611b1c8",
		},
		"without period or weekday rows": {[]timetable.TemplateListEntry{entry(base, 901, 1, nil)}, nil, "9eb7a156d6d141b25f4a6cee2714faaa"},
		"in a period": {
			[]timetable.TemplateListEntry{entry(inPeriod, 902, 3, nil), entry(inPeriod, 901, 1, nil)}, roster,
			"6440fc662acd1fccf9c7fa285884e378",
		},
		"in a period without weekday rows": {[]timetable.TemplateListEntry{entry(inPeriod, 901, 1, nil)}, nil, "6a3658097efa2cc073cc1007ce59f385"},
		"bare":                             {[]timetable.TemplateListEntry{{TemplateListRow: bare}}, nil, "21593622b4242d056b2490bfa38eed25"},
		"gone":                             {nil, nil, "692d4a7bd3757277b806e961fef351c4"},
	} {
		assert.Equal(t, tc.want, timetable.TemplateSeriesVersion(tc.entries, tc.roster), name)
	}
}
