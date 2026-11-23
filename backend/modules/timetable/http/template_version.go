package timetablehttp

import (
	"context"
	"errors"
	"net/http"
	"slices"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// templateState is the canonical form of a Regeltermin segment as its
// editor saves it back: the template's stored fields, its schedules and its
// roster. Display names, counts and the roster-maintenance hint are derived
// and stay out, so renaming a room does not refuse a series edit.
type templateState struct {
	ID                          ident.ID                                     `json:"id"`
	Name                        string                                       `json:"name"`
	Type                        string                                       `json:"type"`
	CategoryID                  ident.ID                                     `json:"category_id"`
	PlanningTrackID             *ident.ID                                    `json:"planning_track_id"`
	RoomID                      *ident.ID                                    `json:"room_id"`
	EducationGroupID            *ident.ID                                    `json:"education_group_id"`
	IsOpen                      bool                                         `json:"is_open"`
	MaxParticipants             *int                                         `json:"max_participants"`
	CalendarPeriodID            *ident.ID                                    `json:"calendar_period_id"`
	TargetGroupType             string                                       `json:"target_group_type"`
	TargetGradeLevel            *int16                                       `json:"target_grade_level"`
	TargetSchoolClass           *string                                      `json:"target_school_class"`
	Targets                     []templateTargetState                        `json:"targets"`
	SourceCareOfferingIDs       []ident.ID                                   `json:"source_care_offering_ids"`
	SourceGradeLevels           []int                                        `json:"source_grade_levels"`
	SourceSchoolClasses         []string                                     `json:"source_school_classes"`
	ListKind                    *string                                      `json:"list_kind"`
	Notes                       *string                                      `json:"notes"`
	IncludeClosingDays          bool                                         `json:"include_closing_days"`
	EndDate                     *string                                      `json:"end_date"`
	RequiredStaffOverride       *int                                         `json:"required_staff_override"`
	StudentIDs                  []ident.ID                                   `json:"student_ids"`
	StaffIDs                    []ident.ID                                   `json:"staff_ids"`
	PrimaryStaffID              *ident.ID                                    `json:"primary_staff_id"`
	Schedules                   []templateScheduleResponse                   `json:"schedules"`
	WeekdayAssignments          []templateWeekdayAssignmentResponse          `json:"weekday_assignments"`
	ProtectedStudentAssignments []templateProtectedStudentAssignmentResponse `json:"protected_student_assignments"`
	ManualRosterConfirmed       bool                                         `json:"manual_roster_confirmed"`
}

type templateTargetState struct {
	Type             string    `json:"type"`
	GradeLevel       *int16    `json:"grade_level"`
	SchoolClass      *string   `json:"school_class"`
	EducationGroupID *ident.ID `json:"education_group_id"`
}

// templateVersion is the read-state token of a template segment (ADR 0311),
// taken over templateTokenState on the read and the check side alike.
// The rosters of that state are kept to the school day, so a token read
// before midnight is refused once after it.
func templateVersion(t templateResponse) string {
	state := templateState{
		ID: t.ID, Name: t.Name, Type: t.Type, CategoryID: t.CategoryID, PlanningTrackID: t.PlanningTrackID,
		RoomID: t.RoomID, EducationGroupID: t.EducationGroupID, IsOpen: t.IsOpen, MaxParticipants: t.MaxParticipants,
		CalendarPeriodID: t.CalendarPeriodID, TargetGroupType: t.TargetGroupType, TargetGradeLevel: t.TargetGradeLevel,
		TargetSchoolClass: t.TargetSchoolClass, Targets: make([]templateTargetState, 0, len(t.Targets)),
		SourceCareOfferingIDs: t.SourceCareOfferingIDs, SourceGradeLevels: t.SourceGradeLevels,
		SourceSchoolClasses: t.SourceSchoolClasses, ListKind: t.ListKind, Notes: t.Notes,
		IncludeClosingDays: t.IncludeClosingDays, EndDate: t.EndDate, RequiredStaffOverride: t.RequiredStaffOverride,
		StudentIDs: sortedIdents(t.StudentIDs), StaffIDs: sortedIdents(t.StaffIDs), PrimaryStaffID: t.PrimaryStaffID,
		Schedules: slices.Clone(t.Schedules), WeekdayAssignments: t.WeekdayAssignments,
		ProtectedStudentAssignments: t.ProtectedStudentAssignments, ManualRosterConfirmed: t.ManualRosterConfirmed,
	}
	for _, target := range t.Targets {
		state.Targets = append(state.Targets, templateTargetState{
			Type: target.Type, GradeLevel: target.GradeLevel, SchoolClass: target.SchoolClass, EducationGroupID: target.EducationGroupID,
		})
	}
	slices.SortFunc(state.Schedules, func(a, b templateScheduleResponse) int {
		return compareIdent(a.ID, b.ID)
	})
	return readstate.Fingerprint(state)
}

// templateTokenState loads the stored segment its token covers. The
// segment's fields, schedules and combined roster come from its period-free
// read: the editor's read is scoped to a planning period and the save may
// move the series to another one, so only the unscoped read is the same
// stored state on both sides. That read keeps only the period-free weekday
// rows, while a save writes them under the series' planning period: for a
// series in a period its weekday roster, protected children and per-weekday
// Hauptbetreuung are read in that period, as its editor shows them. It
// answers nil for a segment the unscoped read no longer returns.
func (rs *Resource) templateTokenState(ctx context.Context, templateID int64) (*templateResponse, error) {
	templates, err := rs.loadTemplates(ctx, &templateID, nil)
	if err != nil || len(templates) == 0 {
		return nil, err
	}
	state := templates[0]
	if state.CalendarPeriodID == nil {
		return &state, nil
	}
	weekdayRoster, err := rs.TimetableData.ListTemplateWeekdayRoster(ctx, &templateID, (*int64)(state.CalendarPeriodID))
	if err != nil {
		return nil, err
	}
	state.WeekdayAssignments = buildTemplateWeekdayAssignments(weekdayRoster)[templateID]
	state.ProtectedStudentAssignments = buildTemplateProtectedStudentAssignments(weekdayRoster)[templateID]
	return &state, nil
}

// templateReadVersion answers the segment's token. A segment the unscoped
// read no longer returns has the token of no state.
func (rs *Resource) templateReadVersion(ctx context.Context, templateID int64) (string, error) {
	state, err := rs.templateTokenState(ctx, templateID)
	if err != nil {
		return "", err
	}
	if state == nil {
		return readstate.Fingerprint(nil), nil
	}
	return templateVersion(*state), nil
}

// lockTemplateForWrite takes the tenant recurrence gate every template write
// holds, before anything of the segment is read, so the read check below
// and the write see the same stored segment (ADR 0311). The services take
// the gate again; the transaction already holds it.
func (rs *Resource) lockTemplateForWrite(w http.ResponseWriter, r *http.Request) bool {
	if rs.RecurrenceLock == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("recurrence lock not wired")))
		return false
	}
	if err := rs.RecurrenceLock.LockRecurrenceWrites(r.Context()); err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("lock recurrence writes failed", err))
		return false
	}
	return true
}

// checkTemplateReadVersion refuses a write whose editor read another segment
// than the one stored now. It runs under lockTemplateForWrite.
// A segment the read does not find passes: the write itself answers that it
// is gone, as it did before the check.
func (rs *Resource) checkTemplateReadVersion(w http.ResponseWriter, r *http.Request, templateID int64, expected string) bool {
	state, err := rs.templateTokenState(r.Context(), templateID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("load template failed", err))
		return false
	}
	if state == nil {
		return true
	}
	if err := readstate.Check(expected, templateVersion(*state)); err != nil {
		common.RenderError(w, r, common.ErrorBusinessRejection(err))
		return false
	}
	return true
}

func sortedIdents(ids []ident.ID) []ident.ID {
	out := slices.Clone(ids)
	slices.SortFunc(out, compareIdent)
	if out == nil {
		return []ident.ID{}
	}
	return out
}

func compareIdent(a, b ident.ID) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}
