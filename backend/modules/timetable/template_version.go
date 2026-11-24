package timetable

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// TemplateSeriesVersion is the read-state token of a Regeltermin segment
// (ADR 0311): the template's stored fields, its schedules and its roster as
// the editor saves them back. Display names, counts and the
// roster-maintenance hint are derived and stay out, so renaming a room does
// not refuse a series edit.
//
// entries are the segment's rows of the period-free template read
// (ListTemplateEntries for the one template): the editor's read is scoped to
// a planning period and a save may move the series to another one, so only
// the unscoped read is the same stored state on the read and the write side.
// weekdayRoster is ListTemplateWeekdayRoster of the template in its own
// planning period (TemplateCalendarPeriodID, nil for a series without one),
// as its editor shows it. The rosters of that state are kept to the school
// day, so a token read before midnight is refused once after it. A segment
// without entries has the token of no state.
//
// The canonical form is the one the editor's read answered before the owner
// took it over, so a token handed out earlier stays valid.
func TemplateSeriesVersion(entries []TemplateListEntry, weekdayRoster []TemplateWeekdayRosterRow) string {
	if len(entries) == 0 {
		return readstate.Fingerprint(nil)
	}
	first := entries[0]
	state := templateSeriesState{
		ID: first.TemplateID, Name: first.Name, Type: first.Type, CategoryID: first.CategoryID,
		PlanningTrackID: first.PlanningTrackID, RoomID: first.RoomID, EducationGroupID: first.EducationGroupID,
		IsOpen: first.IsOpen, MaxParticipants: ParticipantLimitPtr(first.MaxParticipants),
		CalendarPeriodID: first.TemplateCalendarPeriodID, TargetGroupType: first.TargetGroupType,
		TargetGradeLevel: first.TargetGradeLevel, TargetSchoolClass: first.TargetSchoolClass,
		Targets:               make([]templateSeriesTargetState, 0, len(first.Targets)),
		SourceCareOfferingIDs: first.SourceCareOfferingIDs, SourceGradeLevels: first.SourceGradeLevels,
		SourceSchoolClasses: first.SourceSchoolClasses, ListKind: first.ListKind, Notes: first.Notes,
		IncludeClosingDays: first.IncludeClosingDays, EndDate: first.SeriesLastDay,
		RequiredStaffOverride: requiredStaffOverride(first.RequiredStaff),
		StudentIDs:            sortedSeriesIDs(first.StudentIDs), StaffIDs: sortedSeriesIDs(first.StaffIDs),
		PrimaryStaffID: first.PrimaryStaffID, Schedules: []templateSeriesScheduleState{},
		ManualRosterConfirmed: first.ManualRosterConfirmed,
	}
	for _, target := range first.Targets {
		state.Targets = append(state.Targets, templateSeriesTargetState{
			Type: target.TargetGroupType, GradeLevel: target.TargetGradeLevel,
			SchoolClass: target.TargetSchoolClass, EducationGroupID: target.EducationGroupID,
		})
	}
	for _, entry := range entries {
		if entry.TemplateID == first.TemplateID {
			state.Schedules = append(state.Schedules, templateSeriesSchedule(entry.TemplateListRow))
		}
	}
	slices.SortFunc(state.Schedules, func(a, b templateSeriesScheduleState) int {
		return compareSeriesID(a.ID, b.ID)
	})
	state.WeekdayAssignments, state.ProtectedStudentAssignments = templateSeriesWeekdays(first.TemplateID, weekdayRoster)
	if first.TemplateCalendarPeriodID == nil {
		// A series without a planning period shows no weekday as empty
		// lists; one in a period as none at all.
		if state.WeekdayAssignments == nil {
			state.WeekdayAssignments = []templateSeriesWeekdayState{}
		}
		if state.ProtectedStudentAssignments == nil {
			state.ProtectedStudentAssignments = []templateSeriesProtectedState{}
		}
	}
	return readstate.Fingerprint(state)
}

// templateSeriesState is the canonical form TemplateSeriesVersion hashes.
// Field order, JSON names and empty values are part of every token handed
// out; changing one refuses every open editor once.
type templateSeriesState struct {
	ID                          int64                          `json:"id"`
	Name                        string                         `json:"name"`
	Type                        string                         `json:"type"`
	CategoryID                  int64                          `json:"category_id"`
	PlanningTrackID             *int64                         `json:"planning_track_id"`
	RoomID                      *int64                         `json:"room_id"`
	EducationGroupID            *int64                         `json:"education_group_id"`
	IsOpen                      bool                           `json:"is_open"`
	MaxParticipants             *int                           `json:"max_participants"`
	CalendarPeriodID            *int64                         `json:"calendar_period_id"`
	TargetGroupType             string                         `json:"target_group_type"`
	TargetGradeLevel            *int16                         `json:"target_grade_level"`
	TargetSchoolClass           *string                        `json:"target_school_class"`
	Targets                     []templateSeriesTargetState    `json:"targets"`
	SourceCareOfferingIDs       []int64                        `json:"source_care_offering_ids"`
	SourceGradeLevels           []int                          `json:"source_grade_levels"`
	SourceSchoolClasses         []string                       `json:"source_school_classes"`
	ListKind                    *string                        `json:"list_kind"`
	Notes                       *string                        `json:"notes"`
	IncludeClosingDays          bool                           `json:"include_closing_days"`
	EndDate                     *string                        `json:"end_date"`
	RequiredStaffOverride       *int                           `json:"required_staff_override"`
	StudentIDs                  []int64                        `json:"student_ids"`
	StaffIDs                    []int64                        `json:"staff_ids"`
	PrimaryStaffID              *int64                         `json:"primary_staff_id"`
	Schedules                   []templateSeriesScheduleState  `json:"schedules"`
	WeekdayAssignments          []templateSeriesWeekdayState   `json:"weekday_assignments"`
	ProtectedStudentAssignments []templateSeriesProtectedState `json:"protected_student_assignments"`
	ManualRosterConfirmed       bool                           `json:"manual_roster_confirmed"`
}

type templateSeriesTargetState struct {
	Type             string  `json:"type"`
	GradeLevel       *int16  `json:"grade_level"`
	SchoolClass      *string `json:"school_class"`
	EducationGroupID *int64  `json:"education_group_id"`
}

type templateSeriesScheduleState struct {
	ID               int64  `json:"id"`
	Weekday          int    `json:"weekday"`
	StartTime        string `json:"start_time"`
	EndTime          string `json:"end_time"`
	WeekPattern      int    `json:"week_pattern"`
	CalendarPeriodID *int64 `json:"calendar_period_id,omitempty"`
	ValidFrom        string `json:"valid_from,omitempty"`
	ValidUntil       string `json:"valid_until,omitempty"`
}

type templateSeriesWeekdayState struct {
	Weekday        int     `json:"weekday"`
	StaffIDs       []int64 `json:"staff_ids"`
	StudentIDs     []int64 `json:"student_ids"`
	PrimaryStaffID *int64  `json:"primary_staff_id,omitempty"`
}

type templateSeriesProtectedState struct {
	Weekday    int     `json:"weekday"`
	StudentIDs []int64 `json:"student_ids"`
}

func templateSeriesSchedule(row TemplateListRow) templateSeriesScheduleState {
	return templateSeriesScheduleState{
		ID: row.ScheduleID, Weekday: row.Weekday, StartTime: textOf(row.StartTime), EndTime: textOf(row.EndTime),
		WeekPattern: row.WeekPattern, CalendarPeriodID: row.CalendarPeriodID,
		ValidFrom: textOf(row.ScheduleValidFrom), ValidUntil: textOf(row.ScheduleValidUntil),
	}
}

// templateSeriesWeekdays groups the template's kind-tagged roster rows into
// one entry per weekday, in the repository's order (template, weekday, kind,
// is_primary, person); nil when the template has none of a kind.
func templateSeriesWeekdays(templateID int64, rows []TemplateWeekdayRosterRow) ([]templateSeriesWeekdayState, []templateSeriesProtectedState) {
	var (
		assignments []templateSeriesWeekdayState
		protected   []templateSeriesProtectedState
	)
	assignmentAt, protectedAt := map[int]int{}, map[int]int{}
	for _, row := range rows {
		if row.TemplateID != templateID {
			continue
		}
		if row.Kind == TemplateWeekdayRosterKindProtectedStudent {
			position, ok := protectedAt[row.Weekday]
			if !ok {
				protected = append(protected, templateSeriesProtectedState{Weekday: row.Weekday, StudentIDs: []int64{}})
				position = len(protected) - 1
				protectedAt[row.Weekday] = position
			}
			protected[position].StudentIDs = append(protected[position].StudentIDs, row.PersonID)
			continue
		}
		position, ok := assignmentAt[row.Weekday]
		if !ok {
			assignments = append(assignments, templateSeriesWeekdayState{Weekday: row.Weekday, StaffIDs: []int64{}, StudentIDs: []int64{}})
			position = len(assignments) - 1
			assignmentAt[row.Weekday] = position
		}
		entry := &assignments[position]
		switch row.Kind {
		case TemplateWeekdayRosterKindStaff:
			entry.StaffIDs = append(entry.StaffIDs, row.PersonID)
			if row.IsPrimary && entry.PrimaryStaffID == nil {
				staffID := row.PersonID
				entry.PrimaryStaffID = &staffID
			}
		case TemplateWeekdayRosterKindStudent:
			entry.StudentIDs = append(entry.StudentIDs, row.PersonID)
		}
	}
	return assignments, protected
}

func requiredStaffOverride(n *int64) *int {
	if n == nil {
		return nil
	}
	v := int(*n)
	return &v
}

func sortedSeriesIDs(ids []int64) []int64 {
	out := slices.Clone(ids)
	slices.SortFunc(out, compareSeriesID)
	if out == nil {
		return []int64{}
	}
	return out
}

func compareSeriesID(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}

func textOf(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
