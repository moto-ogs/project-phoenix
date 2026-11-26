package application

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	activityContract "github.com/moto-ogs/project-phoenix/modules/timetable/activitycontract"
	"github.com/moto-ogs/project-phoenix/modules/timetable/ports"
)

// loadTemplatesPeople loads the people the occurrences of several templates
// receive, keyed by template: enrollments, dynamic target students,
// supervisors and the children's care bounds (#5814). Each read runs once for
// all templates. The recurrence gate is already held and materialization
// writes none of these rows, so every template sees the rows its own reads
// would see after the gate. op prefixes the error operations of the caller.
func (s *materializationService) loadTemplatesPeople(ctx context.Context, templateIDs, targetTemplateIDs []int64, op string) (map[int64]templateRoster, error) {
	rosters := make(map[int64]templateRoster, len(templateIDs))
	if len(templateIDs) == 0 {
		return rosters, nil
	}
	enrollments, err := materializationStudentEnrollments(ctx, s.enrollmentRepo, s.directories, templateIDs)
	if err != nil {
		return nil, &ports.ScheduleError{Op: op + ": load enrollments", Err: err}
	}
	targets := make(map[int64][]int64, len(targetTemplateIDs))
	if len(targetTemplateIDs) > 0 {
		var err error
		targets, err = s.groupRepo.ListTargetStudentIDs(ctx, targetTemplateIDs)
		if err != nil {
			return nil, &ports.ScheduleError{Op: op + ": load target students", Err: err}
		}
	}
	supervisors, err := namedPlannedSupervisors(ctx, s.supervisorRepo, s.directories, templateIDs, "find by group ID")
	if err != nil {
		return nil, &ports.ScheduleError{Op: op + ": load supervisors", Err: err}
	}
	var allTargets []int64
	for _, id := range templateIDs {
		allTargets = append(allTargets, targets[id]...)
	}
	careBounds, err := s.loadCareBounds(ctx, allTargets, enrollments)
	if err != nil {
		return nil, &ports.ScheduleError{Op: op + ": load care bounds", Err: err}
	}
	for _, id := range templateIDs {
		rosters[id] = templateRoster{
			enrollments:      []*activityContract.StudentEnrollment{},
			targetStudentIDs: targets[id],
			supervisors:      []*activityContract.SupervisorPlanned{},
			careBounds:       careBounds,
		}
	}
	for _, enrollment := range enrollments {
		roster := rosters[enrollment.ActivityGroupID]
		roster.enrollments = append(roster.enrollments, enrollment)
		rosters[enrollment.ActivityGroupID] = roster
	}
	for _, supervisor := range supervisors {
		roster := rosters[supervisor.GroupID]
		roster.supervisors = append(roster.supervisors, supervisor)
		rosters[supervisor.GroupID] = roster
	}
	return rosters, nil
}

// materializationStudentEnrollments reads the enrollment fields the recurrence
// engine needs. Unlike the planning UI, materialization never renders names,
// so it reads the alumni verdict without the otherwise unused name lookup.
func materializationStudentEnrollments(
	ctx context.Context,
	enrollments timetable.StudentEnrollmentQuery,
	directories ports.RepositoryDirectories,
	templateIDs []int64,
) ([]*activityContract.StudentEnrollment, error) {
	rows, err := listLegacyStudentEnrollments(ctx, enrollments, timetable.StudentEnrollmentFilter{ActivityGroupIDs: templateIDs, OrderByValidFrom: true}, "find by group ID")
	if err != nil || len(rows) == 0 {
		return rows, err
	}
	if directories.StudentAlumni == nil {
		return nil, errors.New("materialize template: student alumni directory is required")
	}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.StudentID)
	}
	alumni, err := directories.StudentAlumni(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		row.StudentAlumnus = alumni[row.StudentID]
	}
	return rows, nil
}
