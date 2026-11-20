package api

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// The staff members of today's changed Dienst (#7661), by name in DemoStaff:
// an OGS-Büro colleague whose Dienst the Leitung cancels, and the external
// caregiver, who has no Dienst of her own, covering its morning. The
// simulation clocks in neither of them.
const (
	cancelledShiftTodayStaff = "Natalia Schulz"
	coverShiftTodayStaff     = "Ana Silva"
	coverShiftTodayEnd       = "12:00"
)

// seedTodaysShiftChangesStep makes "Heute anders" show a changed Dienstplan:
// the Leitung cancels one colleague's Dienst today for a training and lets the
// external caregiver cover its morning, through the Dienstplan's own
// cancellation route. It runs after this week's shifts, which it changes.
type seedTodaysShiftChangesStep struct{}

func (seedTodaysShiftChangesStep) Name() string { return "Seeding today's changed shift" }

func (seedTodaysShiftChangesStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.FixedSeeder == nil {
		return fmt.Errorf("today's changed shift prerequisites not available")
	}
	return seedTodaysShiftChanges(rt, todaySeedDate())
}

func seedTodaysShiftChanges(rt *Runtime, today seedDate) error {
	cancelledID, coverID := rt.FixedSeeder.staffIDs[cancelledShiftTodayStaff], rt.FixedSeeder.staffIDs[coverShiftTodayStaff]
	if cancelledID == 0 || coverID == 0 {
		return fmt.Errorf("today's changed shift needs %s and %s", cancelledShiftTodayStaff, coverShiftTodayStaff)
	}
	if today.Weekday() == time.Saturday || today.Weekday() == time.Sunday {
		fmt.Println("  weekend: no changed shift today")
		return nil
	}
	rt.Client.BindAuth(rt.TenantAuth)
	raw, err := rt.Client.Get(fmt.Sprintf("/api/staff-shifts?from=%s&to=%s&staff_id=%d", today.String(), today.String(), cancelledID))
	if err != nil {
		return fmt.Errorf("list today's shift: %w", err)
	}
	var envelope struct {
		Data []struct {
			ID        string `json:"id"`
			StartTime string `json:"start_time"`
			Cancelled bool   `json:"cancelled"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("parse today's shift: %w", err)
	}
	// The cover takes the morning until noon; a Dienst that starts later
	// has no morning to cover.
	if len(envelope.Data) == 0 || envelope.Data[0].Cancelled || envelope.Data[0].StartTime >= coverShiftTodayEnd {
		fmt.Println("  no Dienst today to change")
		return nil
	}
	shift := envelope.Data[0]
	if _, err := rt.Client.Put("/api/staff-shifts/"+shift.ID+"/cancellation", map[string]any{
		"cancelled": true, "change_reason": "Fortbildung",
		"replacements": []map[string]any{{
			"staff_id": coverID, "start_time": shift.StartTime,
			"end_time": coverShiftTodayEnd, "break_minutes": 0,
		}},
	}); err != nil {
		return fmt.Errorf("cancel today's shift: %w", err)
	}
	fmt.Println("  1 Dienst cancelled today, its morning covered")
	return nil
}
