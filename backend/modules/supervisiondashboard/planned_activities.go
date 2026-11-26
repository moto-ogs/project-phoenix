package supervisiondashboard

import (
	"context"
	"fmt"
)

// loadPlannedActivities attaches today's offerings of the children (#8194)
// when the school shows them on the child cards. Like arrival and pickup
// they are part of the child's day plan, so they stay behind the planning
// gate (users:read and full access).
func (s *service) loadPlannedActivities(ctx context.Context, projection *DashboardProjection, caller Caller, studentIDs []int64, fullAccess bool, businessDay Date) error {
	if s.deps.PlannedActivities == nil || !planningVisible(caller, studentIDs, fullAccess) {
		return nil
	}
	enabled, err := s.deps.Settings.StudentCardActivitiesEnabled(ctx)
	if err != nil {
		return fmt.Errorf("resolve student card activities setting: %w", err)
	}
	if !enabled {
		return nil
	}
	activities, err := s.deps.PlannedActivities.PlannedActivities(ctx, studentIDs, businessDay)
	if err != nil {
		return fmt.Errorf("load planned activities: %w", err)
	}
	projection.PlannedActivities = append(projection.PlannedActivities, activities...)
	return nil
}
