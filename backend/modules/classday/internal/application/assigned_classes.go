package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/classday"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func (s *dayReports) AssignedClassesReport(ctx context.Context, date calendar.Date) (*classday.AssignedClassesReport, error) {
	weekday, err := classDayPlanKey(ctx, date)
	if err != nil {
		return nil, err
	}
	classes, err := s.caller.GetMySchoolClasses(ctx)
	if err != nil {
		return nil, err
	}
	out, index, allowed := assignedClassScope(date, weekday, classes)
	if len(allowed) == 0 {
		return out, nil
	}
	roster, err := s.rosters.AssignedClassRoster(ctx, allowed, date, weekday)
	if err != nil {
		return nil, err
	}
	facts, err := s.assignedClassFacts(ctx, roster.Students, index, date, out.SchoolDay)
	if err != nil {
		return nil, err
	}
	applyAssignedRoster(out, roster, index, facts)
	return out, nil
}

func assignedClassScope(date calendar.Date, weekday string, classes []string) (*classday.AssignedClassesReport, map[string]int, []string) {
	out := &classday.AssignedClassesReport{
		Date: date, Weekday: weekday, SchoolDay: weekday != "",
		Classes: make([]classday.ClassSummary, 0, len(classes)),
	}
	index := make(map[string]int, len(classes))
	allowed := make([]string, 0, len(classes))
	for _, class := range classes {
		key := schoolstructure.NormalizeClass(class)
		if _, seen := index[key]; seen || key == "" {
			continue
		}
		index[key] = len(out.Classes)
		out.Classes = append(out.Classes, classday.ClassSummary{SchoolClass: class})
		allowed = append(allowed, key)
	}
	return out, index, allowed
}

func (s *dayReports) assignedClassFacts(ctx context.Context, students []classday.AssignedRosterStudent, index map[string]int, date calendar.Date, schoolDay bool) (classDayFacts, error) {
	if !schoolDay {
		return classDayFacts{}, nil
	}
	if s.statusDays == nil || s.careDays == nil || s.times == nil {
		return classDayFacts{}, fmt.Errorf("assigned classes: status/schedule dependencies not configured")
	}
	studentIDs := make([]int64, 0, len(students))
	for _, student := range students {
		if _, ok := index[schoolstructure.NormalizeClass(student.SchoolClass)]; ok {
			studentIDs = append(studentIDs, student.StudentID)
		}
	}
	return s.classDayPlanFacts(ctx, studentIDs, date, false)
}

func applyAssignedRoster(out *classday.AssignedClassesReport, roster classday.AssignedRoster, index map[string]int, facts classDayFacts) {
	out.EnrollmentKnown = roster.EnrollmentKnown
	for class, count := range roster.ListEntries {
		if at, ok := index[schoolstructure.NormalizeClass(class)]; ok {
			totals := &out.Classes[at].Totals
			totals.Students += count
			if out.SchoolDay {
				totals.ListEntries += count
			}
		}
	}
	for _, student := range roster.Students {
		if at, ok := index[schoolstructure.NormalizeClass(student.SchoolClass)]; ok {
			countAssignedStudent(&out.Classes[at], student, facts, out.SchoolDay)
		}
	}
	if !out.EnrollmentKnown {
		for i := range out.Classes {
			out.Classes[i].Totals.Staying = 0
			out.Classes[i].Totals.Leaving = 0
		}
	}
}

func countAssignedStudent(summary *classday.ClassSummary, student classday.AssignedRosterStudent, facts classDayFacts, schoolDay bool) {
	if !schoolDay {
		summary.Totals.Students++
		return
	}
	id := student.StudentID
	row := classday.DayRow{
		WithoutCarePlace: student.WithoutCarePlace,
		Status:           facts.statuses[id],
		StaysToday:       facts.staysToday(id, student.HasOffering),
		PickupChanged:    !student.WithoutCarePlace && facts.pickupChanged[id],
	}
	countDayRow(&summary.Totals, row)
	if dayRowChanged(row) {
		summary.Changes++
	}
}
