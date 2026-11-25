package application

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// AssignedClassRoster uses the same dated membership and approved selections
// as the class sheet. It only loads facts that can change the counters.
func (s *Reports) AssignedClassRoster(ctx context.Context, classes []string, date calendar.Date, weekday string) (enrollment.ClassRosterFacts, error) {
	var out enrollment.ClassRosterFacts
	if len(classes) == 0 {
		return out, nil
	}
	phases, err := s.classDayPhases(ctx, date)
	if err != nil {
		return out, err
	}
	students, withoutPlace, err := s.rosterStudents(ctx, classes, date, s.today())
	if err != nil {
		return out, err
	}
	offering := make(map[int64]bool, len(students))
	if weekday != "" && len(students) > 0 {
		for _, phase := range phases {
			if err := s.markClassRosterOfferings(ctx, phase.id, students, date, weekday, offering); err != nil {
				return out, err
			}
		}
	}
	out.EnrollmentKnown = len(phases) > 0
	out.Students = make([]enrollment.ClassRosterStudentFact, 0, len(students)+len(withoutPlace))
	for _, student := range students {
		out.Students = append(out.Students, enrollment.ClassRosterStudentFact{
			StudentID: student.ID, SchoolClass: student.SchoolClass, HasOffering: offering[student.ID],
		})
	}
	for _, student := range withoutPlace {
		out.Students = append(out.Students, enrollment.ClassRosterStudentFact{
			StudentID: student.ID, SchoolClass: student.SchoolClass, WithoutCarePlace: true,
		})
	}
	out.ListEntries, err = s.assignedClassListEntryCounts(ctx, classes)
	return out, err
}

func (s *Reports) assignedClassListEntryCounts(ctx context.Context, classes []string) (map[string]int, error) {
	if s.deps.ClassListEntries == nil {
		return nil, nil
	}
	entries, err := s.deps.ClassListEntries.ListClassListEntries(ctx, classes)
	if err != nil {
		return nil, fmt.Errorf("class day overview: list class list entries: %w", err)
	}
	counts := make(map[string]int, len(classes))
	for _, entry := range entries {
		counts[entry.SchoolClass]++
	}
	return counts, nil
}

func (s *Reports) markClassRosterOfferings(ctx context.Context, phaseID int64, students []*RosterStudent, date calendar.Date, weekday string, booked map[int64]bool) error {
	filters := enrollment.ClassRosterFilters{PhaseID: phaseID, OfferingDate: &date, SkipGuardianData: true}
	reads, err := s.loadClassRosterEnrollments(ctx, filters, students, classRosterStudentIDs(students))
	if err != nil {
		return err
	}
	if len(reads.children) == 0 {
		return nil
	}
	offerings, err := s.classRosterOfferings(ctx, phaseID)
	if err != nil {
		return err
	}
	in := &classRosterInputs{students: students}
	if _, err := s.attachClassRosterSelections(ctx, filters, in, reads); err != nil {
		return err
	}
	for id, approved := range in.enrollments {
		for _, link := range classRosterMergeOfferingLinks(approved.links) {
			selected := careUsageRowOffering(link, offerings[link.CareOfferingID])
			if strings.TrimSpace(selected.Name) != "" && slices.Contains(selected.Days, weekday) {
				booked[id] = true
				break
			}
		}
	}
	return nil
}
