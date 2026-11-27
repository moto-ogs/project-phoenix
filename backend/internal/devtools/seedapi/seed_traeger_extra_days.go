package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// seedTraegerExtraDaysStep plans two extra care days of the demo Träger
// (#4817). The first is a movable holiday at every school of the Träger,
// included in the monthly contribution and published: two families of the
// hosting school register, and the Träger-Büro confirms the first. The
// second is a bridge day at the hosting school at a price per day and stays
// a draft. The page „Zusatztage“ then shows both kinds of contribution and
// the figures of each school.
type seedTraegerExtraDaysStep struct{}

func (seedTraegerExtraDaysStep) Name() string { return "Seeding the Träger's extra care days" }

func (seedTraegerExtraDaysStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil || rt.Bootstrap == nil || rt.Bootstrap.AdminEmail == "" || rt.Bootstrap.AdminPassword == "" {
		return fmt.Errorf("the Träger extra day seed prerequisites are not available")
	}
	auth, err := seedTraegerSession(rt)
	if err != nil {
		return err
	}
	schools, err := seedTraegerSchoolIDs(rt.Client, auth)
	if err != nil {
		return err
	}
	// The hosting school comes first: the families register there.
	schools = append([]int64{rt.Bootstrap.SchoolID}, slices.DeleteFunc(slices.Clone(schools), func(id int64) bool { return id == rt.Bootstrap.SchoolID })...)
	today := calendar.TodayDate()
	included, err := seedExtraDayOutsideNoCareDays(rt.Client, auth, func(shift int) map[string]any {
		return seedExtraDay("Beweglicher Ferientag", today, seedExtraDayDate(today, 5+shift), true, 0, schools...)
	})
	if err != nil {
		return fmt.Errorf("create the included extra day: %w", err)
	}
	if _, err := seedExtraDayOutsideNoCareDays(rt.Client, auth, func(shift int) map[string]any {
		return seedExtraDay("Brückentag", today, seedExtraDayDate(today, 9+shift), false, 1800, rt.Bootstrap.SchoolID)
	}); err != nil {
		return fmt.Errorf("create the extra day at a day price: %w", err)
	}
	periodID, err := decodeSeedEntityID(included)
	if err != nil {
		return fmt.Errorf("read the included extra day: %w", err)
	}
	published, err := rt.Client.PostWithAuth(auth, fmt.Sprintf("/traeger/holiday-periods/%d/publish", periodID), map[string]any{})
	if err != nil {
		return fmt.Errorf("publish the included extra day: %w", err)
	}
	fmt.Printf("  Träger-Büro: extra day at %d school(s) published, a bridge day at a day price drafted\n", len(schools))
	if skipped, _ := rt.Values[seedHolidayRegistrationsSkippedKey].(bool); skipped {
		return nil
	}
	return seedExtraDayRegistrations(rt, auth, periodID, published)
}

// seedExtraDayRegistrations registers two families of the hosting school for
// the published extra day and confirms the first.
func seedExtraDayRegistrations(rt *Runtime, auth AuthRef, periodID int64, published []byte) error {
	var envelope struct {
		Data struct {
			PublicToken string `json:"public_token"`
			Weeks       []struct {
				ID         ident.ID `json:"id"`
				TimeModels []struct {
					ID ident.ID `json:"id"`
				} `json:"time_models"`
			} `json:"weeks"`
		} `json:"data"`
	}
	if err := json.Unmarshal(published, &envelope); err != nil || envelope.Data.PublicToken == "" ||
		len(envelope.Data.Weeks) == 0 || len(envelope.Data.Weeks[0].TimeModels) == 0 {
		return fmt.Errorf("the extra day has no link or no bookable day")
	}
	day := envelope.Data.Weeks[0]
	families := []struct{ first, last, child, email string }{
		{"Tilda", "Zusatztag", "Jonas", "tilda.zusatztag@example.org"},
		{"Kemal", "Brueckentag", "Elif", "kemal.brueckentag@example.org"},
	}
	var first int64
	for i, family := range families {
		raw, err := rt.Client.PostPublic("/traeger/holiday-registrations/"+envelope.Data.PublicToken, map[string]any{
			"guardian": map[string]any{"first_name": family.first, "last_name": family.last, "email": family.email, "phone": fmt.Sprintf("0151 000020%d", i)},
			"children": []map[string]any{{
				"first_name": family.child, "last_name": family.last, "birth_date": "2017-09-21", "home_school_id": ident.ID(rt.Bootstrap.SchoolID),
				"bookings": []map[string]any{{"week_id": day.ID, "time_model_id": day.TimeModels[0].ID}},
			}},
			"emergency_contacts": []map[string]any{{"name": "Opa " + family.last, "phone": "05402 000020", "relationship": "Großvater"}},
			"privacy_consent":    true, "binding_confirmed": true, "custody_confirmed": true,
			"declaration_name": family.first + " " + family.last, "consent_version": seedHolidayConsentVersion, "retention_days": seedHolidayRetentionDays, "captcha_token": seedTurnstileTestToken,
		})
		var refused *APIError
		if errors.As(err, &refused) && slices.Contains(seedHolidayRefusals, refused.Code) {
			fmt.Printf("  Zusatztag: registration refused (%s)\n", refused.Code)
			return nil
		}
		if err != nil {
			return fmt.Errorf("register a child for the extra day: %w", err)
		}
		if i == 0 {
			if first, err = decodeSeedEntityID(raw); err != nil {
				return fmt.Errorf("read the registration for the extra day: %w", err)
			}
		}
	}
	if err := postReadHolidayConfirmation(rt, auth, periodID, first, map[string]any{"benefits_exemption": false}); err != nil {
		return fmt.Errorf("confirm the registration for the extra day: %w", err)
	}
	fmt.Println("  Zusatztag: two children registered, the first confirmed")
	return nil
}

// seedExtraDayOutsideNoCareDays creates the extra day and, while its date is
// a statutory holiday or a closing day of a school (#4702), moves it on: the
// seed runs on any day of the year.
func seedExtraDayOutsideNoCareDays(client *Client, auth AuthRef, body func(shift int) map[string]any) ([]byte, error) {
	for shift := 0; ; shift++ {
		raw, err := client.PostWithAuth(auth, "/traeger/holiday-periods/", body(shift))
		var refused *APIError
		if shift+1 < seedHolidayPeriodShifts && errors.As(err, &refused) && refused.Code == seedHolidayWeekNoCareDayCode {
			continue
		}
		return raw, err
	}
}

// seedExtraDayDate is the Friday weeks weeks after the coming one, so the
// registration stays open for more than three weeks.
func seedExtraDayDate(today calendar.Date, weeks int) calendar.Date {
	day := today.AddDays(1)
	for day.Weekday() != time.Friday {
		day = day.AddDays(1)
	}
	return day.AddDays(7 * weeks)
}

// seedExtraDay is an extra care day on date at schools, with care from 07:30
// to 16:00, registration until a week before.
func seedExtraDay(name string, today, date calendar.Date, included bool, priceCents int, schools ...int64) map[string]any {
	days := make([]map[string]any, len(schools))
	for i, school := range schools {
		days[i] = map[string]any{
			"starts_on": date.String(), "ends_on": date.String(), "host_school_id": ident.ID(school),
			"time_models": []map[string]any{{"name": "Betreuung", "starts_at": "07:30", "ends_at": "16:00", "price_cents": priceCents}},
		}
	}
	return map[string]any{
		"kind": "extra_day", "included_in_fee": included, "name": name,
		"registration_opens_on": today.String(), "registration_closes_on": date.AddDays(-7).String(),
		"binding": true, "notes": "Bitte gebt eurem Kind ein Frühstück und ein Mittagessen mit.", "weeks": days,
	}
}
