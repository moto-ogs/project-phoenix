package api

import "fmt"

// putWeeklyPickupSchedules replaces a child's weekly pickup rows the way the
// Betreuungsplan editor saves them: with the weekly plan token it read just
// before (ADR 0311).
func putWeeklyPickupSchedules(client *Client, studentID int64, schedules []map[string]any) error {
	version, err := weeklyPlanVersionVia(client, studentID)
	if err != nil {
		return err
	}
	_, err = client.Put(fmt.Sprintf("/api/students/%d/pickup-schedules", studentID), map[string]any{
		"schedules": schedules, "expected_version": version,
	})
	return err
}
