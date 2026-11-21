package api

import (
	"context"
	"fmt"
	"time"
)

// seedTodaysBlockStaffStep gives "Heute anders" (#7675) a supervisor who
// misses a single block of today and a block somebody else covers, beside
// the sick colleague's covered blocks. It uses the Vertretungsplan's own
// route and runs after today's changed blocks: the cancelled, reinstated and
// moved blocks are the latest of the day, so this step takes the earliest
// blocks that have not ended.
type seedTodaysBlockStaffStep struct{}

func (seedTodaysBlockStaffStep) Name() string {
	return "Seeding today's absence and cover of single blocks"
}

func (seedTodaysBlockStaffStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.FixedSeeder == nil {
		return fmt.Errorf("today's block staff prerequisites not available")
	}
	return seedTodaysBlockStaff(rt, todaySeedDate(), time.Now())
}

func seedTodaysBlockStaff(rt *Runtime, today seedDate, now time.Time) error {
	if today.Weekday() == time.Saturday || today.Weekday() == time.Sunday {
		fmt.Println("  weekend: no block absences today")
		return nil
	}
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)

	blocks, err := changeableBlocksToday(rt, today)
	if err != nil {
		return err
	}
	clock := now.In(seedBerlinLocation()).Format("15:04")
	var open []seedChangeableBlock
	for _, block := range blocks {
		if len(block.Staff) > 0 && clockOf(block.EndTime) > clock {
			open = append(open, block)
		}
	}
	if len(open) < 2 {
		fmt.Printf("  %d open blocks with staff today, no block absence\n", len(open))
		return nil
	}
	// The list runs from the latest block to the earliest.
	missed, covered := open[len(open)-1], open[len(open)-2]
	if err := postBlockDeviation(rt, missed, int64(missed.Staff[0].StaffID), 0); err != nil {
		return err
	}
	absent := int64(covered.Staff[0].StaffID)
	standIn := blockStandIn(orderedSeedStaffIDs(rt.FixedSeeder), covered, absent)
	if standIn == 0 {
		fmt.Printf("  %s misses one block, no stand-in for %s\n", missed.Title, covered.Title)
		return postBlockDeviation(rt, covered, absent, 0)
	}
	if err := postBlockDeviation(rt, covered, absent, standIn); err != nil {
		return err
	}
	fmt.Printf("  one supervisor misses %s, %s is covered\n", missed.Title, covered.Title)
	return nil
}

// postBlockDeviation marks a supervisor absent for one block and, with a
// stand-in, lets the stand-in cover it.
func postBlockDeviation(rt *Runtime, block seedChangeableBlock, absentStaffID, standInID int64) error {
	body := map[string]any{
		"absences": []map[string]any{{"staff_id": absentStaffID, "reason": "Arzttermin", "instance_ids": []int64{int64(block.ID)}}},
	}
	if standInID > 0 {
		body["substitutions"] = []map[string]any{{
			"absent_staff_id": absentStaffID, "substitute_staff_id": standInID,
			"reason": "Vertretung wegen Arzttermin", "instance_ids": []int64{int64(block.ID)},
		}}
	}
	if _, err := rt.Client.Post(fmt.Sprintf("/api/timetable/instances/%d/deviations", block.ID), body); err != nil {
		return fmt.Errorf("seed today's block deviation on %s: %w", block.Title, err)
	}
	return nil
}

// blockStandIn picks the stand-in for a block: a colleague who is not on it
// and not away today. It takes a larger staff id than the absent one, which
// the Vertretungsplan's cover of a Dienst needs until #7683 is fixed.
func blockStandIn(staffIDs []int64, block seedChangeableBlock, absent int64) int64 {
	away := map[int64]bool{}
	for _, index := range []int{sickTodayStaffIndex, substituteTodayStaffIndex, vacationTodayStaffIndex, trainingTodayStaffIndex} {
		if index < len(staffIDs) {
			away[staffIDs[index]] = true
		}
	}
	for _, row := range block.Staff {
		away[int64(row.StaffID)] = true
	}
	var best int64
	for _, id := range staffIDs {
		if id > absent && !away[id] && id > best {
			best = id
		}
	}
	return best
}
