package api

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedParentCancellationNoticeStep cancels a coming offering of the first
// parent account's children and tells the families (#7140): the one notice
// reaches the parents portal's news, its bell and, by the family's choice,
// the phone. It runs after the parent accounts exist; a notice is refused
// for a past date, so the date lies a week ahead, on a weekday.
type seedParentCancellationNoticeStep struct{}

func (seedParentCancellationNoticeStep) Name() string {
	return "Seeding a cancellation the families hear about"
}

func (seedParentCancellationNoticeStep) Run(_ context.Context, rt *Runtime) error {
	if rt.FixedSeeder == nil || len(DemoActivities) == 0 {
		return fmt.Errorf("fixed seeder not available")
	}
	var studentIDs []int64
	for _, parent := range rt.Parents {
		if len(parent.StudentIDs) > 0 {
			studentIDs = parent.StudentIDs
			break
		}
	}
	if len(studentIDs) == 0 {
		return fmt.Errorf("no parent account with children for the cancellation notice")
	}
	name := DemoActivities[0].Name
	roomID := rt.FixedSeeder.activityRoomIDs[rt.FixedSeeder.activityIDs[name]]
	if roomID == 0 {
		return fmt.Errorf("room not available for %s", name)
	}
	date := todaySeedDate().AddDays(7)
	for date.Weekday() == time.Saturday || date.Weekday() == time.Sunday {
		date = date.AddDays(1)
	}
	instanceID, err := createNoticeOccurrence(rt, name, date, roomID, studentIDs)
	if err != nil {
		return err
	}
	if _, err := rt.Client.Post(fmt.Sprintf("/api/timetable/instances/%d/cancel", instanceID), map[string]any{
		"reason": "Raum wird renoviert",
		"guardian_notice": map[string]any{
			"title":   name + " fällt aus",
			"message": name + " fällt am " + date.Format("02.01.") + " aus. Ihr Kind wird in der OGS betreut.",
		},
	}); err != nil {
		return fmt.Errorf("cancel %s with a notice to the families: %w", name, err)
	}
	fmt.Printf("  %s on %s cancelled with a notice to the families\n", name, date)
	return nil
}

func createNoticeOccurrence(rt *Runtime, name string, date seedDate, roomID int64, studentIDs []int64) (int64, error) {
	respBody, err := rt.Client.Post("/api/timetable/instances", map[string]any{
		"date": date.String(), "start_time": "14:00", "end_time": "15:00",
		"title": name, "room_id": ident.ID(roomID), "student_ids": ident.IDs(studentIDs),
	})
	if err != nil {
		return 0, fmt.Errorf("create %s on %s: %w", name, date, err)
	}
	var resp struct {
		Data struct {
			ID json.Number `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return 0, fmt.Errorf("parse %s response: %w", name, err)
	}
	id, err := resp.Data.ID.Int64()
	if err != nil || id == 0 {
		return 0, fmt.Errorf("%s response carries no id", name)
	}
	return id, nil
}
