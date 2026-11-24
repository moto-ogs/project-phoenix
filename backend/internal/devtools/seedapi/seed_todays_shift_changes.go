package api

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The staff members of today's changed Dienst (#7661), by name in DemoStaff:
// the OGS-Büro colleague in the Spätdienst, whose Dienst the Leitung cancels,
// and a colleague in the regular Dienst, which ends at 16:30, covering its
// last half hour. The simulation clocks in neither of them, and no later step
// offboards them. The cover is created after the cancelled colleague, so the
// cancellation locks the two in ascending order (#7683).
const (
	cancelledShiftTodayStaff = "Anna Müller"
	coverShiftTodayStaff     = "Petra Koch"
	coverShiftTodayStart     = regularDutyEnd
)

// seedTodaysShiftChangesStep makes "Heute anders" show a changed Dienstplan:
// the Leitung cancels one colleague's Dienst today for a training and lets a
// colleague cover its end after her own Dienst, through the Dienstplan's
// own cancellation route. It runs after this week's shifts, which it changes.
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
			EndTime   string `json:"end_time"`
			Cancelled bool   `json:"cancelled"`
			Version   string `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("parse today's shift: %w", err)
	}
	// The cover takes over after her own Dienst; a Dienst that ends by then
	// has nothing left to cover.
	if len(envelope.Data) == 0 || envelope.Data[0].Cancelled || envelope.Data[0].EndTime <= coverShiftTodayStart {
		fmt.Println("  no Dienst today to change")
		return nil
	}
	shift := envelope.Data[0]
	if _, err := rt.Client.Put("/api/staff-shifts/"+shift.ID+"/cancellation", map[string]any{
		"cancelled": true, "change_reason": "Fortbildung",
		// The Dienst read above has no cover yet (ADR 0311).
		"expected_version": shift.Version, "expected_replacement_versions": map[string]string{},
		"replacements": []map[string]any{{
			"staff_id": ident.ID(coverID), "start_time": coverShiftTodayStart,
			"end_time": shift.EndTime, "break_minutes": 0,
		}},
	}); err != nil {
		return fmt.Errorf("cancel today's shift: %w", err)
	}
	fmt.Println("  1 Dienst cancelled today, its end covered")
	return nil
}
