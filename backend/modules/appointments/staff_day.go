package appointments

import (
	"context"
	"errors"
)

// StaffDaySpanDays bounds how far back a date of a series may begin and still
// reach the day: the overrides of older dates are not read (#7663).
const StaffDaySpanDays = 31

// StaffDayAppointment is an appointment a staff member sees in the own
// calendar whose dates may reach a day (#7663, #7903): its recurrence rule
// (nil without one) and the overrides of its dates that may reach the day,
// ordered by date.
type StaffDayAppointment struct {
	Appointment *Appointment
	Rule        *RecurrenceRule
	Overrides   []*AppointmentOccurrenceOverride
}

// StaffDayAppointments reads the appointments of a day that a staff member
// sees in the own calendar (organizer or staff recipient, the rule of
// ListAppointmentsVisibleToStaff), each with its rule and the overrides of
// the dates that may reach the day, in one statement and in the caller's
// tenant transaction. An override's date reaches the day when the day lies
// between the date and the date plus the appointment's length, at most
// StaffDaySpanDays back.
type StaffDayAppointments interface {
	ListStaffDayAppointments(ctx context.Context, staffID int64, day Date) ([]StaffDayAppointment, error)
}

// ErrNoStaffDayAppointments reports an appointments query without the read.
var ErrNoStaffDayAppointments = errors.New("appointments: the query reads no staff day")

// StaffDayAppointmentsOf is the staff day read of the appointments query the
// owner composed.
func StaffDayAppointmentsOf(query Query) (StaffDayAppointments, error) {
	reads, ok := query.(StaffDayAppointments)
	if !ok {
		return nil, ErrNoStaffDayAppointments
	}
	return reads, nil
}
