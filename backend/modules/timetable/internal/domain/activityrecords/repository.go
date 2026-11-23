package activityrecords

// CategoryRepository defines operations for managing activity categories

// GroupRepository defines operations for managing activity groups

// GroupTargetRepository manages dynamic target cohorts for timetable templates.

// ScheduleRepository defines operations for managing activity schedules

// SupervisorPlannedRepository defines operations for managing activity supervisors

type PlannedSupervisionBlocker struct {
	ID           int64
	ActivityID   int64
	ActivityName string
	IsPrimary    bool
}

// StudentEnrollmentRepository defines operations for managing student enrollments

// StudentEnrollmentDate keeps legacy compatibility adapters from importing
// the lower-layer calendar-date package.
