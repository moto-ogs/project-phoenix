package presenceprojectionhttp

import (
	context "context"
	fmt "fmt"

	calendar "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// attachPlannedActivities puts the offerings of the listed day on the child
// cards of the returned page (#8194), when the school shows them there. Like
// arrival and pickup they are part of the child's day plan: they need
// users:read and full access to the row. The reads are set-based, so the
// statement count does not grow with the page.
func (rs *Resource) attachPlannedActivities(ctx context.Context, rows []SlimStudentResponse, day calendar.Date) error {
	if rs.PlannedActivities == nil || !canReadSensitiveStudentData(ctx) {
		return nil
	}
	studentIDs := make([]int64, 0, len(rows))
	for i := range rows {
		if rows[i].HasFullAccess {
			studentIDs = append(studentIDs, rows[i].ID.Int64())
		}
	}
	if len(studentIDs) == 0 {
		return nil
	}
	enabled, err := rs.SettingsService.ResolveBool(ctx, settingStudentCardActivitiesEnabled)
	if err != nil {
		return fmt.Errorf("resolve student card activities setting: %w", err)
	}
	if !enabled {
		return nil
	}
	activities, err := rs.PlannedActivities.PlannedActivities(ctx, studentIDs, day)
	if err != nil {
		return fmt.Errorf("load planned activities: %w", err)
	}
	for i := range rows {
		if rows[i].HasFullAccess {
			rows[i].PlannedActivities = activities[rows[i].ID.Int64()]
		}
	}
	return nil
}
