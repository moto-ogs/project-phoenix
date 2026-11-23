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

// dayChangesAppointmentReads is Appointments' read of the caller's calendar
// on a day: the appointments with their rules and the overrides of the dates
// that may reach the day, in one statement (#7903).
type dayChangesAppointmentReads interface {
	ListStaffDayAppointments(ctx context.Context, staffID int64, day appointments.Date) ([]appointments.StaffDayAppointment, error)
}

// dayChangesAppointmentsOf is the staff day read of the composed
// Appointments owner; nil without one, which NewDayChanges rejects.
func dayChangesAppointmentsOf(owner appointments.Query) dayChangesAppointmentReads {
	reads, err := appointments.StaffDayAppointmentsOf(owner)
	if err != nil {
		return nil
	}
	return reads
}

// dayChangesAppointments is the Termine source.
type dayChangesAppointments struct {
	caller dayChangesCaller
	reads  dayChangesAppointmentReads
}

// AppointmentChanges reads today's appointments of the caller in one
// statement besides the caller's staff record (which the Personal source has
// resolved already; the request memoizes it): the appointments with their
// recurrence rules, whose today the rule decides for a cancelled series, and
// the overrides of the dates that may reach today (#7903). A date moved onto
// today from another day is not read; no calendar write moves a date yet.
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
	visible, err := s.reads.ListStaffDayAppointments(ctx, staffID, today)
	if err != nil {
		return nil, fmt.Errorf("list calendar appointments: %w", err)
	}
	entries := []daychangesview.SourceEntry{}
	for _, value := range visible {
		if entry, ok := appointmentChange(value.Appointment, value.Overrides, value.Rule, today); ok {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func overlapsDay(appointment *appointments.Appointment, day appointments.Date) bool {
	return !appointment.StartDate.After(day) && !appointment.EndDate.Before(day)
}

// appointmentChange reports today's exception of one appointment, if any.
// An override exists only for a date of a series: cancelling a single date
// checks the date, and editing the series drops its overrides. Overrides that
// change nothing are skipped, so another date of an overlapping series still
// counts.
func appointmentChange(appointment *appointments.Appointment, overrides []*appointments.AppointmentOccurrenceOverride, rule *appointments.RecurrenceRule, today appointments.Date) (daychangesview.SourceEntry, bool) {
	length := appointment.StartDate.DaysUntil(appointment.EndDate)
	for _, override := range overrides {
		if override.OccurrenceDate.AddDays(length).Before(today) {
			continue
		}
		if appointment.CancelledAt != nil || override.Cancelled {
			return appointmentEntry(daychangesview.KindAppointmentCancelled, appointment, override, today), true
		}
		if entry, ok := changedAppointmentEntry(appointment, override, today); ok {
			return entry, true
		}
	}
	if appointment.CancelledAt == nil {
		return daychangesview.SourceEntry{}, false
	}
	occurrence, ok := cancelledOccurrence(appointment, rule, today)
	if !ok {
		return daychangesview.SourceEntry{}, false
	}
	return appointmentEntry(daychangesview.KindAppointmentCancelled, appointment, &appointments.AppointmentOccurrenceOverride{OccurrenceDate: occurrence}, today), true
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
// another time. A date moved away from today does not take place today and
// reads as cancelled; an override that repeats the series changes nothing.
func changedAppointmentEntry(appointment *appointments.Appointment, override *appointments.AppointmentOccurrenceOverride, today appointments.Date) (daychangesview.SourceEntry, bool) {
	planned := appointments.EffectiveOccurrence(appointment, override.OccurrenceDate, nil)
	effective := appointments.EffectiveOccurrence(appointment, override.OccurrenceDate, override)
	if !overlapsDay(effective, today) {
		return appointmentEntry(daychangesview.KindAppointmentCancelled, appointment, &appointments.AppointmentOccurrenceOverride{OccurrenceDate: override.OccurrenceDate}, today), true
	}
	locationChanged := strings.TrimSpace(dayChangesText(effective.Location)) != strings.TrimSpace(dayChangesText(planned.Location))
	timeChanged := effective.StartDate != planned.StartDate || effective.EndDate != planned.EndDate ||
		effective.AllDay != planned.AllDay ||
		!calendar.SameClockTime(effective.StartTime, planned.StartTime) || !calendar.SameClockTime(effective.EndTime, planned.EndTime)
	if !locationChanged && !timeChanged {
		return daychangesview.SourceEntry{}, false
	}
	entry := appointmentEntry(daychangesview.KindAppointmentChanged, appointment, override, today)
	entry.Appointment.LocationChanged = locationChanged
	entry.Appointment.TimeChanged = timeChanged
	return entry, true
}

// appointmentEntry builds the entry of a date as it takes place
// (EffectiveOccurrence): title and location, the time as instants of a
// single-day date with a time of day, "seit" and "bis" for a date over
// several days. The days are the owner's YYYY-MM-DD text.
func appointmentEntry(kind daychangesview.Kind, appointment *appointments.Appointment, override *appointments.AppointmentOccurrenceOverride, today appointments.Date) daychangesview.SourceEntry {
	effective := appointments.EffectiveOccurrence(appointment, override.OccurrenceDate, override)
	if override.Cancelled || kind == daychangesview.KindAppointmentCancelled {
		// A cancelled date shows what was planned.
		effective = appointments.EffectiveOccurrence(appointment, override.OccurrenceDate, nil)
	}
	day := calendar.Date(today.String())
	first, last := calendar.Date(effective.StartDate.String()), calendar.Date(effective.EndDate.String())
	entry := daychangesview.SourceEntry{
		Kind: kind, Involved: true,
		Appointment: &daychangesview.DayAppointment{
			ID: appointment.ID, OccurrenceDate: calendar.Date(override.OccurrenceDate.String()),
			Title: effective.Title, Location: effective.Location,
		},
		Link: &daychangesview.Link{Target: daychangesview.LinkCalendar},
	}
	if first.Before(day) {
		entry.Since = &first
	}
	if last.After(day) {
		entry.Until = &last
	}
	if !effective.AllDay && first == day && last == day {
		startsAt, endsAt := wallClockOn(day, effective.StartTime), wallClockOn(day, effective.EndTime)
		entry.StartsAt, entry.EndsAt = &startsAt, &endsAt
	}
	return entry
}

// wallClockOn is the instant of a time of day on the school's day.
func wallClockOn(day calendar.Date, clock time.Time) time.Time {
	midnight := day.BerlinMidnight()
	return time.Date(midnight.Year(), midnight.Month(), midnight.Day(), clock.Hour(), clock.Minute(), 0, 0, midnight.Location())
}

// dayChangesText reads an optional text, empty when unset.
func dayChangesText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
