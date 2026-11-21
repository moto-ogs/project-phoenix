package api

// The Termine source of "Heute anders" (ADR 0299, #7663). The owner is
// Appointments: its read of the appointments a staff member may see in the
// own calendar (organizer or staff recipient) is the visibility rule of this
// source, the rule of GET /api/calendar/my (calendar:own and a staff record).
// The binding reads today's dates of these appointments and reports the
// exceptions: a cancelled date of a series, a cancelled appointment, and a
// date moved to another location or another time. Every appointment the
// caller may see is the caller's own, so every entry stands under "Betrifft
// dich".

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// maxAppointmentSpanDays bounds how far back a multi-day date of a series
// may begin and still reach today; the dates the overrides are read for.
const maxAppointmentSpanDays = 31

// dayChangesAppointmentReads is Appointments' read of the caller's calendar.
type dayChangesAppointmentReads interface {
	ListAppointmentsVisibleToStaff(ctx context.Context, staffID int64, from, to appointments.Date) ([]*appointments.Appointment, error)
	FindRecurrenceRules(ctx context.Context, appointmentIDs []int64) ([]*appointments.RecurrenceRule, error)
	FindOccurrenceOverrides(ctx context.Context, appointmentIDs []int64, dates []appointments.Date) ([]*appointments.AppointmentOccurrenceOverride, error)
}

// dayChangesAppointments is the Termine source.
type dayChangesAppointments struct {
	caller dayChangesCaller
	reads  dayChangesAppointmentReads
}

// AppointmentChanges reads today's appointments of the caller in at most
// three statements: the appointments, the overrides of today's dates (only
// with a series among them) and the recurrence rules (only for a cancelled
// series, whose today the rule decides).
func (s dayChangesAppointments) AppointmentChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	if !securityruntime.HasPermission(permissions.CalendarOwn, sessiontoken.PermissionsFromCtx(ctx)) {
		// The account has no own calendar: no entries, not a failure.
		return nil, nil
	}
	staffID, isStaff, err := s.caller.CurrentStaffID(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve caller staff: %w", err)
	}
	if !isStaff {
		return nil, nil
	}
	today := appointments.Date(day.String())
	visible, err := s.reads.ListAppointmentsVisibleToStaff(ctx, staffID, today, today)
	if err != nil {
		return nil, fmt.Errorf("list calendar appointments: %w", err)
	}
	overrides, err := s.todaysOverrides(ctx, visible, today)
	if err != nil {
		return nil, err
	}
	rules, err := s.cancelledSeriesRules(ctx, visible, today)
	if err != nil {
		return nil, err
	}
	entries := []daychangesview.SourceEntry{}
	for _, appointment := range visible {
		if entry, ok := appointmentChange(appointment, overrides[appointment.ID], rules, today, day); ok {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

// todaysOverrides reads the overrides of the dates that may reach today,
// keyed by appointment. A non-recurring appointment has none: a single
// date is cancelled on the appointment itself.
func (s dayChangesAppointments) todaysOverrides(ctx context.Context, visible []*appointments.Appointment, today appointments.Date) (map[int64][]*appointments.AppointmentOccurrenceOverride, error) {
	ids := []int64{}
	span := 0
	for _, appointment := range visible {
		ids = append(ids, appointment.ID)
		span = max(span, min(appointment.StartDate.DaysUntil(appointment.EndDate), maxAppointmentSpanDays))
	}
	if len(ids) == 0 {
		return nil, nil
	}
	dates := make([]appointments.Date, 0, span+1)
	for back := 0; back <= span; back++ {
		dates = append(dates, today.AddDays(-back))
	}
	rows, err := s.reads.FindOccurrenceOverrides(ctx, ids, dates)
	if err != nil {
		return nil, fmt.Errorf("list occurrence overrides: %w", err)
	}
	byAppointment := make(map[int64][]*appointments.AppointmentOccurrenceOverride, len(rows))
	for _, row := range rows {
		byAppointment[row.AppointmentID] = append(byAppointment[row.AppointmentID], row)
	}
	return byAppointment, nil
}

// cancelledSeriesRules reads the rules of the cancelled appointments whose
// own dates miss today: only a series reaches today then, and its rule
// decides whether today is one of its dates.
func (s dayChangesAppointments) cancelledSeriesRules(ctx context.Context, visible []*appointments.Appointment, today appointments.Date) (map[int64]*appointments.RecurrenceRule, error) {
	ids := []int64{}
	for _, appointment := range visible {
		if appointment.CancelledAt != nil && !overlapsDay(appointment, today) {
			ids = append(ids, appointment.ID)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := s.reads.FindRecurrenceRules(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list recurrence rules: %w", err)
	}
	rules := make(map[int64]*appointments.RecurrenceRule, len(rows))
	for _, rule := range rows {
		rules[rule.AppointmentID] = rule
	}
	return rules, nil
}

func overlapsDay(appointment *appointments.Appointment, day appointments.Date) bool {
	return !appointment.StartDate.After(day) && !appointment.EndDate.Before(day)
}

// appointmentChange reports today's exception of one appointment, if any.
// An override exists only for a date of a series: cancelling a single date
// checks the date, and editing the series drops its overrides.
func appointmentChange(appointment *appointments.Appointment, overrides []*appointments.AppointmentOccurrenceOverride, rules map[int64]*appointments.RecurrenceRule, today appointments.Date, day calendar.Date) (daychangesview.SourceEntry, bool) {
	length := appointment.StartDate.DaysUntil(appointment.EndDate)
	for _, override := range overrides {
		if override.OccurrenceDate.AddDays(length).Before(today) {
			continue
		}
		if appointment.CancelledAt != nil || override.Cancelled {
			return appointmentEntry(daychangesview.KindAppointmentCancelled, appointment, override, override.OccurrenceDate, day), true
		}
		return changedAppointmentEntry(appointment, override, day)
	}
	if appointment.CancelledAt == nil {
		return daychangesview.SourceEntry{}, false
	}
	occurrence, ok := cancelledOccurrence(appointment, rules[appointment.ID], today)
	if !ok {
		return daychangesview.SourceEntry{}, false
	}
	return appointmentEntry(daychangesview.KindAppointmentCancelled, appointment, nil, occurrence, day), true
}

// cancelledOccurrence is the date of a cancelled appointment that reaches
// today: its own dates, or a date of its series.
func cancelledOccurrence(appointment *appointments.Appointment, rule *appointments.RecurrenceRule, today appointments.Date) (appointments.Date, bool) {
	if overlapsDay(appointment, today) {
		return appointment.StartDate, true
	}
	if rule == nil {
		return "", false
	}
	dates := appointments.ExpandOccurrences(appointment, rule, today, today)
	if len(dates) == 0 {
		return "", false
	}
	return dates[len(dates)-1], true
}

// changedAppointmentEntry reports a date that takes place elsewhere or at
// another time. An override that repeats the series changes nothing, and one
// that moves the date away from today is not today's.
func changedAppointmentEntry(appointment *appointments.Appointment, override *appointments.AppointmentOccurrenceOverride, day calendar.Date) (daychangesview.SourceEntry, bool) {
	start, end := occurrenceDays(appointment, override, override.OccurrenceDate)
	today := appointments.Date(day.String())
	if start.After(today) || end.Before(today) {
		return daychangesview.SourceEntry{}, false
	}
	locationChanged := override.Location != nil && strings.TrimSpace(*override.Location) != strings.TrimSpace(dayChangesText(appointment.Location))
	timeChanged := start != override.OccurrenceDate ||
		end != override.OccurrenceDate.AddDays(appointment.StartDate.DaysUntil(appointment.EndDate)) ||
		(override.AllDay != nil && *override.AllDay != appointment.AllDay) ||
		(override.StartTime != nil && !calendar.SameClockTime(*override.StartTime, appointment.StartTime)) ||
		(override.EndTime != nil && !calendar.SameClockTime(*override.EndTime, appointment.EndTime))
	if !locationChanged && !timeChanged {
		return daychangesview.SourceEntry{}, false
	}
	entry := appointmentEntry(daychangesview.KindAppointmentChanged, appointment, override, override.OccurrenceDate, day)
	entry.Appointment.LocationChanged = locationChanged
	entry.Appointment.TimeChanged = timeChanged
	if locationChanged {
		entry.Appointment.PreviousLocation = appointment.Location
	}
	return entry, true
}

// occurrenceDays are the first and last day of a date of the appointment,
// with the override's days where it sets them.
func occurrenceDays(appointment *appointments.Appointment, override *appointments.AppointmentOccurrenceOverride, occurrence appointments.Date) (start, end appointments.Date) {
	start = occurrence
	end = occurrence.AddDays(appointment.StartDate.DaysUntil(appointment.EndDate))
	if override != nil && override.StartDate != nil {
		start = *override.StartDate
	}
	if override != nil && override.EndDate != nil {
		end = *override.EndDate
	}
	return start, end
}

// appointmentEntry builds the entry of today's date: title and location as
// the date takes place, the time as instants of a single-day date with a
// time of day, "seit" and "bis" for a date over several days.
func appointmentEntry(kind daychangesview.Kind, appointment *appointments.Appointment, override *appointments.AppointmentOccurrenceOverride, occurrence appointments.Date, day calendar.Date) daychangesview.SourceEntry {
	occurrenceDate, _ := calendar.ParseDate(occurrence.String())
	view := &daychangesview.DayAppointment{
		ID: appointment.ID, OccurrenceDate: occurrenceDate, Title: appointment.Title, Location: appointment.Location,
	}
	allDay, startClock, endClock := appointment.AllDay, appointment.StartTime, appointment.EndTime
	if override != nil {
		if override.Title != nil {
			view.Title = *override.Title
		}
		if override.Location != nil {
			view.Location = override.Location
		}
		if override.AllDay != nil {
			allDay = *override.AllDay
		}
		if override.StartTime != nil {
			startClock = *override.StartTime
		}
		if override.EndTime != nil {
			endClock = *override.EndTime
		}
	}
	entry := daychangesview.SourceEntry{
		Kind: kind, Involved: true, Appointment: view,
		Link: &daychangesview.Link{Target: daychangesview.LinkCalendar},
	}
	start, end := occurrenceDays(appointment, override, occurrence)
	first, _ := calendar.ParseDate(start.String())
	last, _ := calendar.ParseDate(end.String())
	if first.Before(day) {
		entry.Since = &first
	}
	if last.After(day) {
		entry.Until = &last
	}
	if !allDay && first == day && last == day {
		startsAt, endsAt := wallClockOn(day, startClock), wallClockOn(day, endClock)
		entry.StartsAt, entry.EndsAt = &startsAt, &endsAt
	}
	return entry
}

// wallClockOn is the instant of a time of day on the school's day.
func wallClockOn(day calendar.Date, clock time.Time) time.Time {
	midnight := day.BerlinMidnight()
	return time.Date(midnight.Year(), midnight.Month(), midnight.Day(), clock.Hour(), clock.Minute(), 0, 0, midnight.Location())
}

func dayChangesText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
