package api

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedTraegerOpeningChangeStep plans a shorter day for every school of the
// Träger (#8202), through the Träger route in the Träger-Büro admin's
// session: the staff meeting of the Träger three weeks ahead, on a school
// day, when every OGS closes at 13:00. The schools read it as „Vom Träger“.
type seedTraegerOpeningChangeStep struct{}

func (seedTraegerOpeningChangeStep) Name() string { return "Seeding a Träger opening change" }

func (seedTraegerOpeningChangeStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the Träger opening change seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	today := calendar.TodayDate()
	raw, err := rt.Client.GetWithAuth(auth, fmt.Sprintf("/traeger/closing-days/?from=%s&to=%s", today, today.AddDays(30)))
	if err != nil {
		return fmt.Errorf("read the Träger calendar: %w", err)
	}
	_, schools, err := seedBridgeDay(raw)
	if err != nil {
		return err
	}
	if len(schools) == 0 {
		fmt.Println("  Träger-Büro: no school, opening change skipped")
		return nil
	}
	day := seedSchoolDay(today.AddDays(21))
	if _, err := rt.Client.PostWithAuth(auth, "/traeger/opening-changes/", map[string]any{
		"start_date": day.String(), "end_date": day.String(), "opens_at": "07:30", "closes_at": "13:00",
		"reason": "Personalversammlung", "school_ids": ident.IDs(schools),
	}); err != nil {
		return fmt.Errorf("plan the Träger opening change: %w", err)
	}
	fmt.Printf("  Träger-Büro: opening change %s for %d schools\n", day, len(schools))
	return nil
}

// seedSchoolDay moves a Saturday or Sunday on to the Monday after it.
func seedSchoolDay(day calendar.Date) calendar.Date {
	switch day.Weekday() {
	case time.Saturday:
		return day.AddDays(2)
	case time.Sunday:
		return day.AddDays(1)
	}
	return day
}
