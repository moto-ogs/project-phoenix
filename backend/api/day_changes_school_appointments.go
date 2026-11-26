package api

// The Termine source of "Heute anders" in moto schule (#8155). A Lehrkraft
// holds calendar:school, not calendar:own: the rule is the one of the
// calendar of moto schule (GET /school/calendar/my), which lists the
// appointments a staff member may see (organizer or staff recipient) to an
// account with calendar:school and a staff record. Appointments owns the
// read; the exceptions of today are the staff portal's (appointmentChange):
// a cancelled date or appointment, a date at another place or time. Every
// appointment the caller sees is her own, so every entry stands under
// "Betrifft dich" and leads to the calendar of moto schule.

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// schoolDayChangesAppointments is the Termine source of moto schule.
type schoolDayChangesAppointments struct {
	caller schoolDayCallerRead
	reads  dayChangesAppointmentReads
}

// AppointmentChanges reads today's appointments of the caller in one
// statement; the caller's staff record comes from the savepoint's memo.
func (s schoolDayChangesAppointments) AppointmentChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	if !securityruntime.HasAdminWildcard(granted) && !securityruntime.HasPermission(permissions.CalendarSchool, granted) {
		// The account does not read the school calendar: no entries, not a failure.
		return nil, nil
	}
	caller, err := s.caller.resolve(ctx)
	if err != nil {
		return nil, err
	}
	if caller.staffID == 0 {
		return nil, nil
	}
	today := appointments.Date(day.String())
	visible, err := s.reads.ListStaffDayAppointments(ctx, caller.staffID, today)
	if err != nil {
		return nil, fmt.Errorf("list calendar appointments: %w", err)
	}
	entries := []daychangesview.SourceEntry{}
	for _, value := range visible {
		entry, ok := appointmentChange(value.Appointment, value.Overrides, value.Rule, today)
		if !ok {
			continue
		}
		entry.Link = &daychangesview.Link{Target: daychangesview.LinkSchoolCalendar}
		entries = append(entries, entry)
	}
	return entries, nil
}
