//go:build testhooks

package api

import (
	"log/slog"

	dayChangesHTTP "github.com/moto-ogs/project-phoenix/modules/daychangesview/http"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewSchoolDayChangesTestResource binds "Heute anders" of moto schule
// (#7670) over the same owners as production, with the day pinned.
func NewSchoolDayChangesTestResource(db transactionruntime.Database, unit tenant.UnitOfWork, today calendar.Date) (*dayChangesHTTP.SchoolResource, error) {
	caller, err := NewUserContextTestModule(db, unit)
	if err != nil {
		return nil, err
	}
	classArrivals, err := owners.BuildClassArrivals(db, slog.Default())
	if err != nil {
		return nil, err
	}
	membership, err := owners.NewSchoolMembership(db)
	if err != nil {
		return nil, err
	}
	staff, err := schoolmembership.StaffClassReadsOf(membership)
	if err != nil {
		return nil, err
	}
	calendarAppointments, err := NewAppointments(db)
	if err != nil {
		return nil, err
	}
	return NewSchoolDayChanges(SchoolDayChangesSources{
		Caller: caller.Caller(), Staff: staff, ClassArrivals: classArrivals, ClosingDays: owners.NewSchoolClosingDayReads(),
		Appointments: dayChangesAppointmentsOf(calendarAppointments), RoomClosures: NewRoomClosuresForTest(db),
		Today: func() calendar.Date { return today }, Logger: slog.Default(),
	})
}
