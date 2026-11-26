package api

// The reads of "Heute anders" in the Träger-Portal (#7672, #8146). The
// Träger projection reads the Träger's schools with their names at
// Organisation & Tenancy, the closing days and the opening changes at School
// Calendar, the cancelled blocks at Timetable, the cancelled lunch at Meal
// Plan and the closed rooms at Facilities, all in its administrative unit
// over the Träger's schools. The rule of access is the route's: "Übersicht
// sehen" and the schools of the session's Träger. No source names a person
// or a reason, except the name of a closing day.

import (
	"context"
	"errors"

	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	mealplanCompose "github.com/moto-ogs/project-phoenix/modules/mealplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// traegerDayChangePorts binds the projection's day change reads to
// Organisation & Tenancy, the Träger closing days the portal mounts, the
// Timetable owner's count, and the Träger reads of Meal Plan and Facilities.
func traegerDayChangePorts(organizations organizationtenancy.Capability, closingDays traegercalendar.ClosingDays, owner timetable.Owner) (traegerview.DayChangePorts, error) {
	if organizations == nil || closingDays == nil || owner == nil {
		return traegerview.DayChangePorts{}, errors.New("traeger day changes: Organisation & Tenancy, the Träger closing days and the Timetable owner are required")
	}
	schools, err := organizationtenancy.TraegerSchoolsOf(organizations)
	if err != nil {
		return traegerview.DayChangePorts{}, err
	}
	days, err := traegercalendar.SchoolDaysOf(closingDays)
	if err != nil {
		return traegerview.DayChangePorts{}, err
	}
	blocks, err := timetable.TraegerCancelledBlocksOf(owner)
	if err != nil {
		return traegerview.DayChangePorts{}, err
	}
	return traegerview.DayChangePorts{
		Schools: traegerDayChangeSchools{schools: schools}, Days: traegerSchoolCalendarDays{days: days}, Blocks: blocks,
		Meals: mealplanCompose.NewTraegerMealCancellations(), Rooms: facilitiesCompose.NewTraegerRoomClosures(),
	}, nil
}

// traegerDayChangeSchools translates Organisation & Tenancy's schools of the
// Träger into the projection's vocabulary and a deactivated, deleted or
// unknown Träger into its contract (#4657).
type traegerDayChangeSchools struct {
	schools organizationtenancy.TraegerSchools
}

func (s traegerDayChangeSchools) TraegerSchoolsWithNames(ctx context.Context, organizationID int64) ([]traegerview.TraegerSchool, error) {
	schools, err := s.schools.ListTraegerSchools(ctx, organizationID)
	if errors.Is(err, organizationtenancy.ErrOrganizationInactive) || errors.Is(err, organizationtenancy.ErrOrganizationNotFound) {
		return nil, traegerview.ErrTraegerUnavailable
	}
	if err != nil {
		return nil, err
	}
	result := make([]traegerview.TraegerSchool, 0, len(schools))
	for _, school := range schools {
		result = append(result, traegerview.TraegerSchool{ID: ident.ID(school.ID), Name: school.Name, Slug: school.Slug, Subdomain: school.Subdomain, City: school.City})
	}
	return result, nil
}

// traegerSchoolCalendarDays translates School Calendar's closings and
// opening changes into the projection's vocabulary.
type traegerSchoolCalendarDays struct {
	days traegercalendar.SchoolDays
}

func (c traegerSchoolCalendarDays) SchoolCalendarDaysOn(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) (map[int64]traegerview.SchoolCalendarDay, error) {
	days, err := c.days.SchoolDaysOn(ctx, organizationID, schools, day)
	if err != nil {
		return nil, err
	}
	result := make(map[int64]traegerview.SchoolCalendarDay, len(days))
	for school, listed := range days {
		entry := traegerview.SchoolCalendarDay{}
		for _, closing := range listed.Closings {
			entry.Closings = append(entry.Closings, traegerview.SchoolClosingDay{
				StartDate: closing.StartDate, EndDate: closing.EndDate, Name: closing.Reason, Traeger: closing.Traeger,
			})
		}
		for _, opening := range listed.Openings {
			entry.Openings = append(entry.Openings, traegerview.SchoolOpeningChange(opening))
		}
		result[school] = entry
	}
	return result, nil
}
