package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// seedTodaysCalendarChangesStep gives "Heute anders" its Termine (#7663):
// the weekly Teamsitzung of the Leitung falls out today as a single date, and
// today's Infoabend is cancelled as a whole. Both are appointments of the
// seed's Leitung (the organizer) for all staff, so every colleague with a
// calendar sees them under "Betrifft dich". The series began a week ago on
// today's weekday, so the entries appear on any day, a weekend too.
type seedTodaysCalendarChangesStep struct{}

func (seedTodaysCalendarChangesStep) Name() string { return "Seeding today's calendar changes" }

func (seedTodaysCalendarChangesStep) Run(_ context.Context, rt *Runtime) error {
	if rt == nil || rt.Client == nil {
		return fmt.Errorf("today's calendar changes prerequisites not available")
	}
	return seedTodaysCalendarChanges(rt, todaySeedDate())
}

func seedTodaysCalendarChanges(rt *Runtime, today seedDate) error {
	currentAuth := rt.Client.auth
	defer rt.Client.BindAuth(currentAuth)
	rt.Client.BindAuth(rt.TenantAuth)

	lastWeek := today.AddDays(-7).String()
	series, err := postCalendarAppointment(rt, map[string]any{
		"title": "Teamsitzung", "location": "OGS-Büro",
		"description": "Wochenplanung und Absprachen im Team.",
		"start_date":  lastWeek, "end_date": lastWeek, "start_time": "13:00", "end_time": "13:45", "all_day": false,
		"recurrence": map[string]any{
			"frequency": "weekly", "interval_count": 1, "occurrence_count": 6,
			"weekdays": []string{strings.ToLower(today.Weekday().String())},
		},
		"delivery_mode": "informational", "targets": []map[string]any{{"type": "all_staff"}}, "send_email": false,
	})
	if err != nil {
		return err
	}
	if _, err := rt.Client.Post(fmt.Sprintf("/api/calendar/appointments/%d/occurrences/%s/cancel", series, today.String()), nil); err != nil {
		return fmt.Errorf("cancel today's team meeting: %w", err)
	}
	evening, err := postCalendarAppointment(rt, map[string]any{
		"title": "Infoabend Ganztag", "location": "Aula",
		"description": "Vorstellung der AGs für das zweite Halbjahr.",
		"start_date":  today.String(), "end_date": today.String(), "start_time": "18:00", "end_time": "19:30", "all_day": false,
		"delivery_mode": "informational", "targets": []map[string]any{{"type": "all_staff"}}, "send_email": false,
	})
	if err != nil {
		return err
	}
	if _, err := rt.Client.Post(fmt.Sprintf("/api/calendar/appointments/%d/cancel", evening), nil); err != nil {
		return fmt.Errorf("cancel today's info evening: %w", err)
	}
	fmt.Println("  1 cancelled date of a series and 1 cancelled appointment today")
	return nil
}

// postCalendarAppointment creates a staff calendar appointment and returns
// its id.
func postCalendarAppointment(rt *Runtime, appointment map[string]any) (int64, error) {
	raw, err := rt.Client.Post("/api/calendar/appointments", appointment)
	if err != nil {
		return 0, fmt.Errorf("create appointment %s: %w", appointment["title"], err)
	}
	id, err := parseAppointmentID(raw)
	if err != nil {
		return 0, fmt.Errorf("parse appointment %s: %w", appointment["title"], err)
	}
	return id, nil
}

// parseAppointmentID reads the id of the created appointment's detail.
func parseAppointmentID(raw []byte) (int64, error) {
	var envelope struct {
		Data struct {
			Appointment struct {
				ID int64 `json:"id"`
			} `json:"appointment"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return 0, err
	}
	if envelope.Data.Appointment.ID <= 0 {
		return 0, fmt.Errorf("no appointment id in the answer")
	}
	return envelope.Data.Appointment.ID, nil
}
