package timetablehttp

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// templateRosterMaintenanceResponse is the Regeltermin indicator (#3140):
// whether children who are approved later reach the roster and the already
// created future occurrences without staff action.
type templateRosterMaintenanceResponse struct {
	// Mode is "automatic", "partial" or "manual".
	Mode string `json:"mode"`
	// Offerings feed the roster effectively.
	Offerings []templateRosterMaintenanceOfferingResponse `json:"offerings"`
	// GradeLevels / SchoolClasses restrict the source offerings.
	GradeLevels   []int    `json:"grade_levels,omitempty"`
	SchoolClasses []string `json:"school_classes,omitempty"`
	// InactiveOfferings are switched-off source offerings; they stop the
	// source rule until the offering is active again or removed.
	InactiveOfferings []templateRosterMaintenanceOfferingResponse `json:"inactive_offerings,omitempty"`
	// InvalidOfferings are active sources that resync cannot use for this
	// Regeltermin.
	InvalidOfferings []templateRosterMaintenanceOfferingResponse `json:"invalid_offerings,omitempty"`
	// DynamicTargets: a Klasse, Jahrgang or Gruppe target exists. A child who
	// changes Klasse or Gruppe follows on the existing occurrences (#6841); a
	// new child reaches only occurrences created afterwards.
	DynamicTargets bool `json:"dynamic_targets"`
	// CareOfferingsDisabled: offerings are configured, but the school has
	// switched Betreuungsangebote off.
	CareOfferingsDisabled bool `json:"care_offerings_disabled"`
}

type templateRosterMaintenanceOfferingResponse struct {
	ID   ident.ID `json:"id"`
	Name string   `json:"name"`
}

// attachRosterMaintenance fills RosterMaintenance on every template with a
// constant number of reads. A failed read leaves the field empty instead of
// failing the Regeltermin list: the indicator is information, not a gate.
func (rs *Resource) attachRosterMaintenance(
	ctx context.Context,
	templates []templateResponse,
	requestedPeriodID *int64,
) {
	if rs.OfferingSourceOptions == nil || len(templates) == 0 || requestedPeriodID == nil {
		return
	}
	queries := make([]timetable.TemplateRosterMaintenanceQuery, 0, len(templates))
	for _, template := range templates {
		queries = append(queries, timetable.TemplateRosterMaintenanceQuery{
			TemplateID:            template.ID.Int64(),
			CalendarPeriodID:      rosterMaintenanceCalendarPeriodID(template, requestedPeriodID),
			SourceCareOfferingIDs: ident.Int64s(template.SourceCareOfferingIDs),
			SourceGradeLevels:     template.SourceGradeLevels,
			SourceSchoolClasses:   template.SourceSchoolClasses,
			HasDynamicTargets:     templateHasDynamicTargets(template),
		})
	}
	derived, err := rs.OfferingSourceOptions.TemplateRosterMaintenance(ctx, queries)
	if err != nil {
		rs.getLogger().Warn("template list: roster maintenance read failed, omitting indicator",
			slog.String("error", err.Error()),
		)
		return
	}
	for i := range templates {
		templates[i].RosterMaintenance = rosterMaintenanceResponse(derived[templates[i].ID.Int64()])
	}
}

// rosterMaintenanceCalendarPeriodID mirrors the schedule-first period
// resolution used for materialization for a period-scoped read.
func rosterMaintenanceCalendarPeriodID(template templateResponse, requestedPeriodID *int64) *int64 {
	if requestedPeriodID != nil {
		for _, schedule := range template.Schedules {
			if schedule.CalendarPeriodID != nil && schedule.CalendarPeriodID.Int64() == *requestedPeriodID {
				return (*int64)(schedule.CalendarPeriodID)
			}
		}
	}
	if periodID := effectiveTemplateCalendarPeriodID(template); periodID != nil {
		return periodID
	}
	return requestedPeriodID
}

// effectiveTemplateCalendarPeriodID resolves the period that the template's
// schedules actually use. A schedule pin is more specific than the fallback
// stored on the template row.
func effectiveTemplateCalendarPeriodID(template templateResponse) *int64 {
	if len(template.Schedules) > 0 && template.Schedules[0].CalendarPeriodID != nil {
		return (*int64)(template.Schedules[0].CalendarPeriodID)
	}
	return (*int64)(template.CalendarPeriodID)
}

func effectiveScheduleCalendarPeriodID(schedule templateScheduleResponse, template templateResponse) *int64 {
	if schedule.CalendarPeriodID != nil {
		return (*int64)(schedule.CalendarPeriodID)
	}
	return (*int64)(template.CalendarPeriodID)
}

func templateHasDynamicTargets(template templateResponse) bool {
	if len(template.Targets) > 0 {
		return true
	}
	switch template.TargetGroupType {
	case timetable.TargetGroupTypeGrade, timetable.TargetGroupTypeSchoolClass, timetable.TargetGroupTypeEducationGroup:
		return true
	}
	return false
}

func rosterMaintenanceResponse(derived timetable.TemplateRosterMaintenance) *templateRosterMaintenanceResponse {
	return &templateRosterMaintenanceResponse{
		Mode:                  derived.Mode,
		Offerings:             rosterMaintenanceOfferings(derived.Offerings),
		GradeLevels:           derived.GradeLevels,
		SchoolClasses:         derived.SchoolClasses,
		InactiveOfferings:     rosterMaintenanceOfferings(derived.InactiveOfferings),
		InvalidOfferings:      rosterMaintenanceOfferings(derived.InvalidOfferings),
		DynamicTargets:        derived.DynamicTargetsManual,
		CareOfferingsDisabled: derived.CareOfferingsDisabled,
	}
}

func rosterMaintenanceOfferings(offerings []timetable.OfferingRef) []templateRosterMaintenanceOfferingResponse {
	result := make([]templateRosterMaintenanceOfferingResponse, 0, len(offerings))
	for _, offering := range offerings {
		result = append(result, templateRosterMaintenanceOfferingResponse{ID: ident.ID(offering.ID), Name: offering.Name})
	}
	return result
}
