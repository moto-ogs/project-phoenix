package api

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"time"
)

// seedTodaysBlockChangesStep gives "Heute anders" (#7662) today's changed
// blocks beside the sick colleague's covered ones: one block is cancelled,
// one is cancelled and taken back, and one lies in another room than its
// series plans. It uses the planner's own routes and runs after today's
// absences, whose covered blocks it leaves alone.
type seedTodaysBlockChangesStep struct{}

func (seedTodaysBlockChangesStep) Name() string {
	return "Seeding today's cancelled, reinstated and moved blocks"
}

func (seedTodaysBlockChangesStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.FixedSeeder == nil {
		return fmt.Errorf("today's block changes prerequisites not available")
	}
	return seedTodaysBlockChanges(rt, todaySeedDate(), time.Now())
}

// seedChangeableBlock is the part of a planner row the step reads and writes
// back when it moves the block.
type seedChangeableBlock struct {
	ID              int64  `json:"id"`
	Title           string `json:"title"`
	Status          string `json:"status"`
	StartTime       string `json:"start_time"`
	EndTime         string `json:"end_time"`
	RoomID          int64  `json:"room_id"`
	ActivityGroupID *int64 `json:"activity_group_id"`
	Staff           []struct {
		StaffID      int64 `json:"staff_id"`
		IsAbsent     bool  `json:"is_absent"`
		IsSubstitute bool  `json:"is_substitute"`
	} `json:"staff"`
	StudentIDs []int64 `json:"student_ids"`
}

func seedTodaysBlockChanges(rt *Runtime, today seedDate, now time.Time) error {
	if today.Weekday() == time.Saturday || today.Weekday() == time.Sunday {
		fmt.Println("  weekend: no changed blocks today")
		return nil
	}
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)

	blocks, err := changeableBlocksToday(rt, today, now)
	if err != nil {
		return err
	}
	if len(blocks) < 3 {
		fmt.Printf("  %d blocks left today, no changed blocks\n", len(blocks))
		return nil
	}
	// The latest block takes its cancellation back; it has not ended yet.
	reinstated, cancelled, moved := blocks[0], blocks[1], blocks[2]
	reason := "Die Leitung ist heute auf Fortbildung"
	for _, block := range []seedChangeableBlock{reinstated, cancelled} {
		if _, err := rt.Client.Post(fmt.Sprintf("/api/timetable/instances/%d/cancel", block.ID), map[string]any{"reason": reason}); err != nil {
			return fmt.Errorf("cancel %s today: %w", block.Title, err)
		}
	}
	if _, err := rt.Client.Post(fmt.Sprintf("/api/timetable/instances/%d/reinstate", reinstated.ID), map[string]any{}); err != nil {
		return fmt.Errorf("reinstate %s today: %w", reinstated.Title, err)
	}
	if err := moveBlockToday(rt, today, moved); err != nil {
		return err
	}
	fmt.Printf("  %s cancelled, %s cancelled and taken back, %s in another room\n", cancelled.Title, reinstated.Title, moved.Title)
	return nil
}

// changeableBlocksToday lists today's planned series blocks that have not
// ended, the latest first. The sick colleague's covered blocks and every
// block with a planned absence or a substitute stay as they are.
func changeableBlocksToday(rt *Runtime, today seedDate, now time.Time) ([]seedChangeableBlock, error) {
	raw, err := rt.Client.Get(fmt.Sprintf("/api/timetable/instances?from=%s&to=%s", today.String(), today.String()))
	if err != nil {
		return nil, fmt.Errorf("list today's planning instances: %w", err)
	}
	var envelope struct {
		Data struct {
			Instances []seedChangeableBlock `json:"instances"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("parse today's planning instances: %w", err)
	}
	clock := now.In(seedBerlinLocation()).Format("15:04")
	var blocks []seedChangeableBlock
	for _, block := range envelope.Data.Instances {
		if block.Status != "planned" || block.ActivityGroupID == nil || block.RoomID == 0 ||
			slices.Contains(coveredSubstituteBlocks, block.Title) || clockOf(block.EndTime) <= clock || blockHasDeviation(block) {
			continue
		}
		blocks = append(blocks, block)
	}
	sort.SliceStable(blocks, func(i, j int) bool { return blocks[i].EndTime > blocks[j].EndTime })
	return blocks, nil
}

func blockHasDeviation(block seedChangeableBlock) bool {
	for _, staff := range block.Staff {
		if staff.IsAbsent || staff.IsSubstitute {
			return true
		}
	}
	return false
}

// clockOf keeps "HH:MM" of a wall clock "HH:MM[:SS]".
func clockOf(value string) string {
	if len(value) > 5 {
		return value[:5]
	}
	return value
}

// moveBlockToday puts one block of today into another room, with its staff
// and children unchanged: the planner's single-occurrence edit.
func moveBlockToday(rt *Runtime, today seedDate, block seedChangeableBlock) error {
	to := otherSeedRoom(rt.FixedSeeder.roomIDs, block.RoomID)
	if to == 0 {
		return fmt.Errorf("no other room for %s", block.Title)
	}
	staffIDs := make([]int64, 0, len(block.Staff))
	for _, staff := range block.Staff {
		staffIDs = append(staffIDs, staff.StaffID)
	}
	body := map[string]any{
		"date": today.String(), "start_time": clockOf(block.StartTime), "end_time": clockOf(block.EndTime),
		"title": block.Title, "room_id": to, "activity_group_id": block.ActivityGroupID,
		"staff_ids": staffIDs, "student_ids": block.StudentIDs,
	}
	if _, err := rt.Client.Put(fmt.Sprintf("/api/timetable/instances/%d", block.ID), body); err != nil {
		return fmt.Errorf("move %s today: %w", block.Title, err)
	}
	return nil
}
