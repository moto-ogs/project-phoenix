package api

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
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
	ID              ident.ID  `json:"id"`
	Title           string    `json:"title"`
	Status          string    `json:"status"`
	StartTime       string    `json:"start_time"`
	EndTime         string    `json:"end_time"`
	RoomID          ident.ID  `json:"room_id"`
	ActivityGroupID *ident.ID `json:"activity_group_id"`
	Staff           []struct {
		StaffID      ident.ID `json:"staff_id"`
		IsAbsent     bool     `json:"is_absent"`
		IsSubstitute bool     `json:"is_substitute"`
	} `json:"staff"`
	StudentIDs []ident.ID `json:"student_ids"`
	// Version is the block's read-state token; the edit sends it back (ADR
	// 0311).
	Version string `json:"version"`
}

func seedTodaysBlockChanges(rt *Runtime, today seedDate, now time.Time) error {
	if today.Weekday() == time.Saturday || today.Weekday() == time.Sunday {
		fmt.Println("  weekend: no changed blocks today")
		return nil
	}
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)

	blocks, err := changeableBlocksToday(rt, today)
	if err != nil {
		return err
	}
	if len(blocks) < 2 {
		fmt.Printf("  %d planned blocks today, no changed blocks\n", len(blocks))
		return nil
	}
	// The latest block takes its cancellation back while it has not ended;
	// the planner refuses to take back the cancellation of an ended block.
	cancelled, moved := blocks[0], blocks[1]
	var reinstated *seedChangeableBlock
	if len(blocks) > 2 && clockOf(blocks[0].EndTime) > now.In(seedBerlinLocation()).Format("15:04") {
		reinstated, cancelled, moved = &blocks[0], blocks[1], blocks[2]
	}
	reason := "Die Leitung ist heute auf Fortbildung"
	toCancel := []seedChangeableBlock{cancelled}
	if reinstated != nil {
		toCancel = append(toCancel, *reinstated)
	}
	for _, block := range toCancel {
		if _, err := rt.Client.Post(fmt.Sprintf("/api/timetable/instances/%d/cancel", block.ID), map[string]any{"reason": reason}); err != nil {
			return fmt.Errorf("cancel %s today: %w", block.Title, err)
		}
	}
	if reinstated != nil {
		if _, err := rt.Client.Post(fmt.Sprintf("/api/timetable/instances/%d/reinstate", reinstated.ID), map[string]any{}); err != nil {
			return fmt.Errorf("reinstate %s today: %w", reinstated.Title, err)
		}
	}
	if err := moveBlockToday(rt, today, moved); err != nil {
		return err
	}
	fmt.Printf("  %s cancelled, %s in another room, reinstated: %t\n", cancelled.Title, moved.Title, reinstated != nil)
	return nil
}

// changeableBlocksToday lists today's planned series blocks, the latest
// first. The sick colleague's covered blocks and every
// block with a planned absence or a substitute stay as they are.
func changeableBlocksToday(rt *Runtime, today seedDate) ([]seedChangeableBlock, error) {
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
	var blocks []seedChangeableBlock
	for _, block := range envelope.Data.Instances {
		if block.Status != "planned" || block.ActivityGroupID == nil || block.RoomID == 0 ||
			slices.Contains(coveredSubstituteBlocks, block.Title) || blockHasDeviation(block) {
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
	to := otherSeedRoom(rt.FixedSeeder.roomIDs, int64(block.RoomID))
	if to == 0 {
		return fmt.Errorf("no other room for %s", block.Title)
	}
	staffIDs := make([]int64, 0, len(block.Staff))
	for _, staff := range block.Staff {
		staffIDs = append(staffIDs, int64(staff.StaffID))
	}
	body := map[string]any{
		"date": today.String(), "start_time": clockOf(block.StartTime), "end_time": clockOf(block.EndTime),
		"title": block.Title, "room_id": ident.ID(to), "activity_group_id": block.ActivityGroupID,
		"staff_ids": ident.IDs(staffIDs), "student_ids": block.StudentIDs, "expected_version": block.Version,
	}
	if _, err := rt.Client.Put(fmt.Sprintf("/api/timetable/instances/%d", block.ID), body); err != nil {
		return fmt.Errorf("move %s today: %w", block.Title, err)
	}
	return nil
}
