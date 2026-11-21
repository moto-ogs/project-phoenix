package application

import (
	"context"
	"errors"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The Einsatzplanung of the Träger (#4708, ADR 0242). The week view reads
// each school in its own tenant transaction: the live employments of the
// Personalakten there, their shifts, and once per record the Soll of its
// Arbeitsverträge. A write runs in the tenant transaction of the school it
// plans for, through the school's Dienstplan, which checks every
// Einsatzort of the record. Every read and write of a school writes its
// access entry there first.

var _ workforce.TraegerStaffPlanning = (*TraegerStaff)(nil)

// planningPerson collects one record over the schools of the week.
type planningPerson struct {
	record domain.TraegerStaffRecord
	sites  []workforce.TraegerPlanningSite
	shifts []workforce.TraegerPlanningShift
	soll   map[string]int
	// sollDays is the Soll by school and day of the shown week.
	sollDays []workforce.TraegerPlanningSollDay
	// absentDays are the full absence days by school of the shown week.
	absentDays []workforce.TraegerPlanningAbsentDay
}

// planningScene is what the week view reads in the Träger transaction.
type planningScene struct {
	schools []workforce.TraegerStaffSchool
	names   map[int64]string
	records []domain.TraegerStaffRecord
}

func (t *TraegerStaff) planningScene(ctx context.Context, actor workforce.TraegerStaffActor) (planningScene, error) {
	schools, err := t.ports.Schools.TraegerSchools(ctx, actor.OrganizationID)
	if err != nil {
		return planningScene{}, err
	}
	scene := planningScene{schools: schools, names: schoolNames(schools)}
	err = t.released(ctx, actor, func(ctx context.Context) error {
		scene.records, err = t.store.ListStaffRecords(ctx, actor.OrganizationID)
		return err
	})
	return scene, err
}

// PlanningWeek shows the week of weekStart (moved to its Monday; empty is
// this week) for every
// Personalakte with a live Einsatzort. A school that cannot be read is
// listed as unreached; the others still show. view names the access entry
// of every school, the page or its export.
func (t *TraegerStaff) PlanningWeek(ctx context.Context, actor workforce.TraegerStaffActor, weekStart calendar.Date, view string) (workforce.TraegerPlanningWeek, error) {
	if t.sites == nil {
		return workforce.TraegerPlanningWeek{}, errors.New("workforce traeger planning: the Dienstplan of the schools is not bound")
	}
	if weekStart == "" {
		weekStart = calendar.Date(t.clock.Today())
	}
	monday := weekStart.StartOfISOWeek()
	scene, err := t.planningScene(ctx, actor)
	if err != nil {
		return workforce.TraegerPlanningWeek{}, err
	}
	week := workforce.TraegerPlanningWeek{WeekStart: monday, Schools: scene.schools, People: []workforce.TraegerPlanningPerson{},
		Unreached: []workforce.TraegerStaffSchool{}, Rules: publicRules(domain.StatutoryWorkingTimeRules(), true)}
	people := make(map[int64]*planningPerson, len(scene.records))
	bySchool := linksBySchool(scene.records, people)
	for _, school := range scene.schools {
		links := bySchool[school.ID.Int64()]
		if len(links) == 0 {
			continue
		}
		err := t.ports.Runtime.WithinSchool(ctx, school.ID.Int64(), func(ctx context.Context) error {
			return t.readPlanningSchool(ctx, actor, view, school, links, people, monday, &week.Rules)
		})
		if err != nil {
			t.warn("traeger planning week: school unreached", "school_id", school.ID, "error", err)
			week.Unreached = append(week.Unreached, school)
		}
	}
	week.People = planningPeople(scene.records, people, week.Rules, monday)
	return week, nil
}

// planningLink is one link of a record at a school.
type planningLink struct {
	recordID int64
	staffID  int64
}

func linksBySchool(records []domain.TraegerStaffRecord, people map[int64]*planningPerson) map[int64][]planningLink {
	result := map[int64][]planningLink{}
	for _, record := range records {
		people[record.ID] = &planningPerson{record: record, soll: map[string]int{}}
		for _, link := range record.Links {
			result[link.SchoolID] = append(result[link.SchoolID], planningLink{recordID: record.ID, staffID: link.StaffID})
		}
	}
	return result
}

// readPlanningSchool reads one school of the week in its tenant transaction
// and logs the read as accessView.
// Each school adds its own share of the Soll, without its own holidays and
// closing days (ADR 0242 point 2).
func (t *TraegerStaff) readPlanningSchool(ctx context.Context, actor workforce.TraegerStaffActor, accessView string, school workforce.TraegerStaffSchool,
	links []planningLink, people map[int64]*planningPerson, monday calendar.Date, rules *workforce.TraegerPlanningRules,
) error {
	live, err := t.liveStaff(ctx, links)
	if err != nil || len(live) == 0 {
		return err
	}
	staffIDs := slices.Sorted(maps.Keys(live))
	if err := t.ports.Access.RecordTraegerStaffAccess(ctx, workforce.TraegerStaffAccess{
		OrganizationID: actor.OrganizationID, AccountID: actor.AccountID, View: accessView,
		Rows: len(live), StaffIDs: staffIDs,
	}); err != nil {
		return err
	}
	sollRecords := slices.Sorted(maps.Values(live))
	sollRecords = slices.Compact(sollRecords)
	view, err := t.sites.SiteWeek(ctx, workforce.TraegerSiteWeekQuery{
		StaffIDs: staffIDs, From: monday.AddDays(-1), To: monday.AddDays(6),
		SollRecordIDs: sollRecords, SollFrom: monday, SollTo: monday.AddDays(6),
	})
	if err != nil {
		return err
	}
	*rules = view.Rules
	for staffID, recordID := range live {
		people[recordID].sites = append(people[recordID].sites, workforce.TraegerPlanningSite{SchoolID: school.ID, SchoolName: school.Name, StaffID: ident.ID(staffID)})
	}
	for _, shift := range view.Shifts {
		person := people[live[shift.StaffID]]
		person.shifts = append(person.shifts, planningShift(shift, school))
	}
	type recordDay struct {
		recordID int64
		date     calendar.Date
	}
	sollDays := map[recordDay]bool{}
	for _, day := range view.Soll {
		person := people[day.StaffRecordID]
		person.soll[day.Date.StartOfISOWeek().String()] += day.Minutes
		if day.Minutes > 0 {
			person.sollDays = append(person.sollDays, workforce.TraegerPlanningSollDay{SchoolID: school.ID, Date: day.Date, Minutes: day.Minutes})
			sollDays[recordDay{day.StaffRecordID, day.Date}] = true
		}
	}
	// Only the absence days that change a suggestion leave the school: a day
	// with Soll there, today or later. The kind of absence never does.
	today := calendar.Date(t.clock.Today())
	for _, day := range view.AbsentDays {
		recordID := live[day.StaffID]
		if day.Date.Before(today) || !sollDays[recordDay{recordID, day.Date}] {
			continue
		}
		person := people[recordID]
		person.absentDays = append(person.absentDays, workforce.TraegerPlanningAbsentDay{SchoolID: school.ID, Date: day.Date})
	}
	return nil
}

// liveStaff maps the live employments among links to their records.
func (t *TraegerStaff) liveStaff(ctx context.Context, links []planningLink) (map[int64]int64, error) {
	staffIDs := make([]int64, 0, len(links))
	recordOf := make(map[int64]int64, len(links))
	for _, link := range links {
		staffIDs = append(staffIDs, link.staffID)
		recordOf[link.staffID] = link.recordID
	}
	employments, err := t.ports.Employments.SchoolEmployments(ctx, staffIDs)
	if err != nil {
		return nil, err
	}
	live := make(map[int64]int64, len(employments))
	for _, employment := range employments {
		if recordID, ok := recordOf[employment.StaffID]; ok {
			live[employment.StaffID] = recordID
		}
	}
	return live, nil
}

// planningPeople orders the records with a live Einsatzort by name and adds
// the week's minutes and warnings.
func planningPeople(records []domain.TraegerStaffRecord, people map[int64]*planningPerson, rules workforce.TraegerPlanningRules, monday calendar.Date) []workforce.TraegerPlanningPerson {
	result := make([]workforce.TraegerPlanningPerson, 0, len(records))
	for _, record := range records {
		person := people[record.ID]
		if len(person.sites) == 0 {
			continue
		}
		result = append(result, person.public(rules, monday))
	}
	slices.SortFunc(result, func(a, b workforce.TraegerPlanningPerson) int {
		if order := strings.Compare(strings.ToLower(a.LastName), strings.ToLower(b.LastName)); order != 0 {
			return order
		}
		if order := strings.Compare(strings.ToLower(a.FirstName), strings.ToLower(b.FirstName)); order != 0 {
			return order
		}
		return int(a.RecordID - b.RecordID)
	})
	return result
}

func (p *planningPerson) public(rules workforce.TraegerPlanningRules, monday calendar.Date) workforce.TraegerPlanningPerson {
	slices.SortFunc(p.sites, func(a, b workforce.TraegerPlanningSite) int { return strings.Compare(a.SchoolName, b.SchoolName) })
	slices.SortFunc(p.shifts, func(a, b workforce.TraegerPlanningShift) int {
		if order := a.Date.Compare(b.Date); order != 0 {
			return order
		}
		return strings.Compare(a.StartTime, b.StartTime)
	})
	person := workforce.TraegerPlanningPerson{RecordID: ident.ID(p.record.ID), FirstName: p.record.FirstName, LastName: p.record.LastName,
		Sites: p.sites, Shifts: []workforce.TraegerPlanningShift{}, SollDays: p.weekSollDays(),
		AbsentDays: append([]workforce.TraegerPlanningAbsentDay{}, p.absentDays...), Warnings: []workforce.ShiftWorkingTimeWarning{}}
	slots := make([]domain.PlanSlot, 0, len(p.shifts))
	for _, shift := range p.shifts {
		if shift.Cancelled {
			person.Shifts = appendInWeek(person.Shifts, shift, monday)
			continue
		}
		slot := planSlot(shift)
		slots = append(slots, slot)
		if !shift.Date.Before(monday) {
			person.Shifts = append(person.Shifts, shift)
			person.PlannedMinutes += slot.End - slot.Start - slot.BreakMinutes
		}
	}
	if soll, ok := p.soll[monday.String()]; ok && soll > 0 {
		person.SollMinutes = &soll
	}
	check := domain.WorkingTimeRules{MaxDailyMinutes: rules.MaxDailyMinutes, MinRestMinutes: rules.MinRestMinutes, CheckBreaks: rules.CheckBreaks}
	for _, warning := range domain.EvaluateWorkingTime(check, slots, p.soll) {
		if !warning.Date.Before(monday) {
			person.Warnings = append(person.Warnings, workforce.ShiftWorkingTimeWarning{Kind: warning.Kind, Date: warning.Date,
				Minutes: warning.Minutes, Limit: warning.Limit, NeedsReason: warning.NeedsReason})
		}
	}
	return person
}

// weekSollDays orders the Soll of the week by day and school; the schools
// read it for the shown week only.
func (p *planningPerson) weekSollDays() []workforce.TraegerPlanningSollDay {
	days := append([]workforce.TraegerPlanningSollDay{}, p.sollDays...)
	slices.SortFunc(days, func(a, b workforce.TraegerPlanningSollDay) int {
		if order := a.Date.Compare(b.Date); order != 0 {
			return order
		}
		switch {
		case a.SchoolID < b.SchoolID:
			return -1
		case a.SchoolID > b.SchoolID:
			return 1
		}
		return 0
	})
	return days
}

func appendInWeek(shifts []workforce.TraegerPlanningShift, shift workforce.TraegerPlanningShift, monday calendar.Date) []workforce.TraegerPlanningShift {
	if shift.Date.Before(monday) {
		return shifts
	}
	return append(shifts, shift)
}

func planSlot(shift workforce.TraegerPlanningShift) domain.PlanSlot {
	return domain.PlanSlot{SchoolID: shift.SchoolID.Int64(), ShiftID: shift.ID.Int64(), Date: shift.Date, Start: clockMinutes(shift.StartTime),
		End: clockMinutes(shift.EndTime), BreakMinutes: shift.BreakMinutes}
}

func clockMinutes(value string) int {
	parsed, err := time.Parse("15:04", value)
	if err != nil {
		return 0
	}
	return parsed.Hour()*60 + parsed.Minute()
}

func planningShift(shift workforce.PlannedShift, school workforce.TraegerStaffSchool) workforce.TraegerPlanningShift {
	result := workforce.TraegerPlanningShift{
		ID: ident.ID(shift.ID), SchoolID: school.ID, SchoolName: school.Name, StaffID: ident.ID(shift.StaffID), Date: calendar.Date(shift.Date),
		StartTime: shortClock(shift.StartTime), EndTime: shortClock(shift.EndTime), BreakMinutes: shift.BreakMinutes, Notes: shift.Notes,
		Cancelled: shift.Cancelled, PlannedByTraeger: shift.PlannedByTraeger, FromSeries: shift.SeriesID != nil,
	}
	if shift.ShiftType != nil {
		result.ShiftTypeName, result.ShiftTypeColor = shift.ShiftType.Name, shift.ShiftType.Color
	}
	return result
}

// shortClock cuts a wall clock to HH:MM.
func shortClock(value string) string {
	if len(value) >= 5 {
		return value[:5]
	}
	return value
}

func publicRules(rules domain.WorkingTimeRules, enabled bool) workforce.TraegerPlanningRules {
	return workforce.TraegerPlanningRules{Enabled: enabled, MaxDailyMinutes: rules.MaxDailyMinutes, MinRestMinutes: rules.MinRestMinutes, CheckBreaks: rules.CheckBreaks}
}
