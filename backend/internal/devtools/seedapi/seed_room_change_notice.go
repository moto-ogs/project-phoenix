package api

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

// seedRoomChangeNoticeStep moves a coming block of the first parent
// account's children to another room (#7141): the planned staff and the
// families find the room change in their bell. The block lies on the next
// school day: a notice for tomorrow from Sunday to Thursday, one for a later
// day after a Friday or Saturday seed.
type seedRoomChangeNoticeStep struct{}

func (seedRoomChangeNoticeStep) Name() string {
	return "Seeding a room change the staff and the families hear about"
}

func (seedRoomChangeNoticeStep) Run(_ context.Context, rt *Runtime) error {
	if rt.FixedSeeder == nil || len(DemoActivities) == 0 {
		return fmt.Errorf("fixed seeder not available")
	}
	studentIDs := firstParentChildren(rt)
	if len(studentIDs) == 0 {
		return fmt.Errorf("no parent account with children for the room change")
	}
	name := DemoActivities[0].Name
	from := rt.FixedSeeder.activityRoomIDs[rt.FixedSeeder.activityIDs[name]]
	to := otherSeedRoom(rt.FixedSeeder.roomIDs, from)
	if from == 0 || to == 0 {
		return fmt.Errorf("two rooms not available for %s", name)
	}
	staffIDs := orderedSeedStaffIDs(rt.FixedSeeder)
	if len(staffIDs) > 3 {
		staffIDs = staffIDs[:3]
	}
	date := nextSeedSchoolDay(todaySeedDate().AddDays(1))
	body := map[string]any{
		"date": date.String(), "start_time": "15:00", "end_time": "16:00",
		"title": name, "room_id": from, "student_ids": studentIDs, "staff_ids": staffIDs,
	}
	raw, err := rt.Client.Post("/api/timetable/instances", body)
	if err != nil {
		return fmt.Errorf("create %s on %s: %w", name, date, err)
	}
	var created struct {
		Data struct {
			ID      json.Number `json:"id"`
			Version string      `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &created); err != nil {
		return fmt.Errorf("parse %s response: %w", name, err)
	}
	instanceID, err := created.Data.ID.Int64()
	if err != nil || instanceID == 0 {
		return fmt.Errorf("%s response carries no id", name)
	}
	body["room_id"] = to
	// The create answers the block's version; the move saves back that
	// block (ADR 0311).
	body["expected_version"] = created.Data.Version
	if _, err := rt.Client.Put(fmt.Sprintf("/api/timetable/instances/%d", instanceID), body); err != nil {
		return fmt.Errorf("move %s to another room: %w", name, err)
	}
	fmt.Printf("  %s on %s moved to another room\n", name, date)
	return nil
}

// otherSeedRoom is the first room by name that is not the given one.
func otherSeedRoom(rooms map[string]int64, not int64) int64 {
	names := make([]string, 0, len(rooms))
	for name := range rooms {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if id := rooms[name]; id != 0 && id != not {
			return id
		}
	}
	return 0
}

// firstParentChildren are the children of the first parent account that has
// any.
func firstParentChildren(rt *Runtime) []int64 {
	for _, parent := range rt.Parents {
		if len(parent.StudentIDs) > 0 {
			return parent.StudentIDs
		}
	}
	return nil
}

// nextSeedSchoolDay is date, or the Monday after it on a weekend.
func nextSeedSchoolDay(date seedDate) seedDate {
	for date.Weekday() == time.Saturday || date.Weekday() == time.Sunday {
		date = date.AddDays(1)
	}
	return date
}
