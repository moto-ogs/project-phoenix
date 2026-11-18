package api

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/moto-ogs/project-phoenix/demoprofile"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NeighbourAttendanceTicker changes only the selected demo children, once per
// arrival or pickup, through the school's usual web attendance command.
type NeighbourAttendanceTicker struct {
	school         demoprofile.NeighbourAttendance
	client         *Client
	openStays      func(context.Context, calendar.Date) ([]string, error)
	day            calendar.Date
	calendarLoaded bool
	closed         bool
	openLoaded     bool
	staffCheck     bool
	arrived, open  []string
}

func NewNeighbourAttendanceTicker(school demoprofile.NeighbourAttendance, adapter Adapter, openStays func(context.Context, calendar.Date) ([]string, error)) *NeighbourAttendanceTicker {
	return &NeighbourAttendanceTicker{school: school, client: NewClientWithAdapter(adapter, false), openStays: openStays}
}

func (t *NeighbourAttendanceTicker) Tick(ctx context.Context, now time.Time) error {
	today := calendar.DateFromTime(now)
	if t.day != today {
		t.day, t.calendarLoaded, t.closed = today, false, false
		t.openLoaded, t.staffCheck = false, true
		t.arrived, t.open = nil, nil
	}
	if !t.openLoaded {
		if err := t.loadOpenStays(ctx); err != nil {
			return err
		}
	}
	arrivals, departures := t.changes(now)
	if len(arrivals)+len(departures) == 0 && !(t.staffCheck && len(t.open) == 0) {
		return nil
	}
	return t.apply(ctx, arrivals, departures)
}

// Close settles the demo's own check-ins when its visitor goes idle.
func (t *NeighbourAttendanceTicker) Close(ctx context.Context, now time.Time) error {
	if calendar.DateFromTime(now) != t.day || !t.staffCheck {
		return nil
	}
	if !t.openLoaded {
		if err := t.loadOpenStays(ctx); err != nil {
			return err
		}
	}
	return t.apply(ctx, nil, t.open)
}

func (t *NeighbourAttendanceTicker) loadOpenStays(ctx context.Context) error {
	ids, err := t.openStays(ctx, t.day)
	if err != nil {
		return err
	}
	t.open, t.openLoaded = ids, true
	for _, id := range ids {
		if !slices.Contains(t.arrived, id) {
			t.arrived = append(t.arrived, id)
		}
	}
	return nil
}

func (t *NeighbourAttendanceTicker) apply(ctx context.Context, arrivals, departures []string) error {
	err := t.sync(ctx, arrivals, departures)
	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.StatusCode == 401 {
		t.client.BindAuth(AuthRef{})
		err = t.sync(ctx, arrivals, departures)
	}
	if err != nil {
		// A write may have committed before the transport failed.
		t.openLoaded = false
	}
	return err
}

func (t *NeighbourAttendanceTicker) changes(now time.Time) (arrivals, departures []string) {
	for _, child := range t.school.Children {
		id := strconv.FormatInt(child.StudentID, 10)
		switch neighbourAttendanceAction(child, now) {
		case "in":
			if !t.closed && !slices.Contains(t.arrived, id) {
				arrivals = append(arrivals, id)
			}
		case "out":
			if slices.Contains(t.open, id) {
				departures = append(departures, id)
			}
		}
	}
	return arrivals, departures
}

func neighbourAttendanceAction(child demoprofile.NeighbourChild, now time.Time) string {
	weekday := calendar.ISOWeekday(calendar.DateFromTime(now))
	for _, booked := range child.Weekdays {
		if day, _ := calendar.CanonicalDayToISOWeekday(booked); day == weekday {
			clock := now.In(calendar.Berlin).Format("15:04")
			switch {
			case clock >= child.Pickup:
				return "out"
			case clock >= child.Arrival:
				return "in"
			}
		}
	}
	return ""
}

func (t *NeighbourAttendanceTicker) sync(ctx context.Context, arrivals, departures []string) error {
	if t.client.auth.Token == "" {
		admin := t.school.Admin
		auth, err := t.client.adapter.LoginTenant(ctx, admin.Email, admin.Password, t.school.TenantSlug)
		if err != nil {
			return err
		}
		t.client.BindAuth(auth)
	}
	if len(arrivals) > 0 && !t.calendarLoaded {
		closed, err := seedClosedDays(&Runtime{Client: t.client, TenantAuth: t.client.auth}, t.day, t.day)
		if err != nil {
			return err
		}
		t.calendarLoaded, t.closed = true, closed[t.day]
	}
	if t.closed {
		arrivals = nil
	}
	if len(departures) > 0 {
		owned, err := t.openStays(ctx, t.day)
		if err != nil {
			return err
		}
		// The visitor may have checked a child out and back in since our tick.
		t.open = owned
		departures = slices.DeleteFunc(slices.Clone(departures), func(id string) bool { return !slices.Contains(owned, id) })
	}
	t.staffCheck = true
	if _, err := t.batch(ctx, "out", departures); err != nil {
		return err
	}
	t.open = slices.DeleteFunc(t.open, func(id string) bool { return slices.Contains(departures, id) })
	opened, err := t.batch(ctx, "in", arrivals)
	if err != nil {
		return err
	}
	t.open = append(t.open, opened...)
	t.arrived = append(t.arrived, arrivals...)
	if len(t.open) == 0 {
		return t.checkOutStaff(ctx)
	}
	return nil
}

func (t *NeighbourAttendanceTicker) checkOutStaff(ctx context.Context) error {
	open, err := hasOpenWorkSession(ctx, t.client)
	if err != nil {
		return err
	}
	if open {
		if _, _, err := t.client.adapter.Raw(ctx, t.client.auth, "POST", "/api/time-tracking/check-out", nil, nil); err != nil {
			return err
		}
	}
	t.staffCheck = false
	return nil
}

func (t *NeighbourAttendanceTicker) batch(ctx context.Context, action string, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	raw, _, err := t.client.adapter.Raw(ctx, t.client.auth, "POST", "/api/students/school-checkin/batch", map[string]any{"action": action, "student_ids": ids}, nil)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data struct {
			Results []struct {
				StudentID string `json:"student_id"`
				Changed   bool   `json:"changed"`
			} `json:"results"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &response); err != nil {
		return nil, err
	}
	// The route counts rejected IDs only for children who cannot be checked
	// in or out anymore, such as children removed during a demo.
	if len(response.Data.Results) != len(ids) {
		return nil, fmt.Errorf("incomplete demo attendance response")
	}
	var changed []string
	for _, result := range response.Data.Results {
		if result.Changed {
			changed = append(changed, result.StudentID)
		}
	}
	return changed, nil
}
