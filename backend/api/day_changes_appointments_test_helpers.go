//go:build testhooks

package api

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/appointments"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// DayChangesTestAppointment is a calendar appointment of the Termine source
// tests (#7663): one day from StartHour to EndHour, weekly on its weekday
// when Weekly is set, with the staff recipients Invited.
type DayChangesTestAppointment struct {
	Organizer          int64
	Invited            []int64
	Title, Location    string
	Day                calendar.Date
	StartHour, EndHour int
	Weekly             bool
}

// DayChangesTestCalendar writes appointments through Appointments' own
// commands, the writes the calendar routes run.
type DayChangesTestCalendar struct{ owner appointments.Capability }

// NewDayChangesTestCalendar composes the appointment owner for the tests.
func NewDayChangesTestCalendar(db transactionruntime.Database) (DayChangesTestCalendar, error) {
	owner, err := NewAppointments(db)
	return DayChangesTestCalendar{owner: owner}, err
}

// InSchool keeps ctx's database and moves it to the school tenantID, for
// the second school of a test on its own database.
func (DayChangesTestCalendar) InSchool(ctx context.Context, tenantID int64) context.Context {
	return tenant.WithTenantID(ctx, tenantID)
}

func clockAt(hour int) time.Time { return time.Date(1, time.January, 1, hour, 0, 0, 0, time.UTC) }

// Create writes the appointment, its weekly rule and its recipients.
func (c DayChangesTestCalendar) Create(ctx context.Context, value DayChangesTestAppointment) (int64, error) {
	day := appointments.Date(value.Day.String())
	location := value.Location
	created, _, err := c.owner.CreateAppointment(ctx, appointments.CreateAppointment{
		AppointmentFields: appointments.AppointmentFields{
			OrganizerStaffID: value.Organizer, Title: value.Title, Location: &location,
			StartDate: day, EndDate: day, StartTime: clockAt(value.StartHour), EndTime: clockAt(value.EndHour),
			DeliveryMode: appointments.DeliveryModeInformational,
		},
		Targets: []appointments.AppointmentTargetFields{{TargetType: appointments.TargetTypeAllStaff}},
	})
	if err != nil {
		return 0, err
	}
	if value.Weekly {
		if err := c.owner.CreateRecurrenceRule(ctx, &appointments.RecurrenceRule{
			AppointmentID: created.ID, Frequency: appointments.RecurrenceFrequencyWeekly, IntervalCount: 1,
		}); err != nil {
			return 0, err
		}
	}
	recipients := make([]appointments.AppointmentRecipientFields, 0, len(value.Invited))
	for _, staffID := range value.Invited {
		recipients = append(recipients, appointments.AppointmentRecipientFields{
			RecipientType: appointments.RecipientTypeStaff, StaffID: &staffID, Status: appointments.ResponseStatusInfo,
		})
	}
	if len(recipients) > 0 {
		if _, _, err := c.owner.CreateAppointmentRecipients(ctx, created.ID, recipients); err != nil {
			return 0, err
		}
	}
	return created.ID, nil
}

// DayChangesTestException is what happens to an appointment: the whole
// appointment is cancelled (Whole), one date of its series is cancelled
// (Cancel), or one date moves to Location and, with a positive StartHour,
// to other hours, and with MoveTo to another day.
type DayChangesTestException struct {
	Whole, Cancel      bool
	Location           string
	StartHour, EndHour int
	MoveTo             calendar.Date
}

// Except writes the exception of the appointment on day through the
// owner's commands: "Termin absagen", "Nur diesen Termin absagen" or a
// changed single date.
func (c DayChangesTestCalendar) Except(ctx context.Context, appointmentID int64, day calendar.Date, change DayChangesTestException) error {
	switch {
	case change.Whole:
		_, err := c.owner.CancelAppointment(ctx, appointmentID)
		return err
	case change.Cancel:
		_, err := c.owner.CancelAppointmentOccurrence(ctx, appointmentID, appointments.Date(day.String()))
		return err
	}
	override := &appointments.AppointmentOccurrenceOverride{AppointmentID: appointmentID, OccurrenceDate: appointments.Date(day.String())}
	if change.Location != "" {
		override.Location = &change.Location
	}
	if change.MoveTo != "" {
		moved := appointments.Date(change.MoveTo.String())
		override.StartDate, override.EndDate = &moved, &moved
	}
	if change.StartHour > 0 {
		start, end := clockAt(change.StartHour), clockAt(change.EndHour)
		override.StartTime, override.EndTime = &start, &end
	}
	return c.owner.CreateOccurrenceOverride(ctx, override)
}
