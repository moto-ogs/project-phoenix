// Package compose wires the School Calendar module over the shared tenant runtime and the Bun database.
package compose

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/adapters/openholidays"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/ports"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

type Observation = ports.Observation

// PersistenceRuntime exposes the compose-owned ambient tenant transaction to legacy School Calendar persistence adapters.
type PersistenceRuntime struct {
	Database func(context.Context) (bun.IDB, error)
	TenantID func(context.Context) int64
}

// PersistenceRuntimeFor builds the migration bridge for legacy calendar repositories without tenant-runtime imports.
func PersistenceRuntimeFor(db *bun.DB) PersistenceRuntime {
	if db == nil {
		panic("school calendar compose: database is required")
	}
	return PersistenceRuntime{Database: postgres.NewPersistenceDatabase(), TenantID: tenant.FromContext}
}

// RecordsDependencies are the bindings of the Records: the database, the federal state of the holiday reads and the root's clock of the school's day (nil is the real clock).
type RecordsDependencies struct {
	// ClosingDayReads includes only the current Träger’s closing days (ADR 0194).
	ClosingDayReads schoolcalendar.ClosingDayReads
	DB              *bun.DB
	Observe         func(Observation)
	// FederalState resolves the tenant's federal-state ISO code (operations.federal_state).
	FederalState func(context.Context) (string, error)
	Now          func() time.Time
}

// NewRecords composes the School Calendar without the period administration, for the owners a root builds before the ones the administration asks (#4080); NewAdministration adds it later.
func NewRecords(dependencies RecordsDependencies) (schoolcalendar.Days, error) {
	if dependencies.DB == nil || dependencies.Observe == nil || dependencies.FederalState == nil || dependencies.ClosingDayReads == nil {
		return nil, errors.New("school calendar compose: all dependencies are required")
	}
	now := dependencies.Now
	if now == nil {
		now = time.Now
	}
	return application.New(postgres.New(postgres.NewCompositionDatabase(), dependencies.ClosingDayReads, now), ports.Observer(dependencies.Observe), application.Administration{Transaction: writeTransaction, Today: application.BerlinDay(now), FederalState: dependencies.FederalState}, application.LocalCalendar{}), nil
}

// AdministrationDependencies are the collaborators of the period administration.
type AdministrationDependencies struct {
	DB      *bun.DB
	Observe func(Observation)
	// RecurrenceGate serializes the administration against recurrence writes (shared lock).
	RecurrenceGate func(context.Context) error
	// CareOfferingGuard refuses a change (replacement set) or removal (nil) a linked care offering still needs (ErrCalendarPeriodRequiredByCareOffering).
	CareOfferingGuard func(ctx context.Context, periodID int64, replacement *schoolcalendar.CalendarPeriodFields) error
	// Today names the current day in YYYY-MM-DD; nil is the Berlin day, the school's day.
	Today func() string
	// ClosingDayNotices tells the school of a changed closing day (#7144).
	ClosingDayNotices schoolcalendar.ClosingDayNotices
}

// NewAdministration adds the period administration to the Records: the whole School Calendar, which the period editor drives.
func NewAdministration(records schoolcalendar.Days, dependencies AdministrationDependencies) (schoolcalendar.Calendar, error) {
	if records == nil || dependencies.DB == nil || dependencies.Observe == nil || dependencies.RecurrenceGate == nil || dependencies.CareOfferingGuard == nil {
		return nil, errors.New("school calendar compose: all dependencies are required")
	}
	today := dependencies.Today
	if today == nil {
		today = application.BerlinDay(time.Now)
	}
	return application.WithAdministration(records, application.Administration{
		Transaction: writeTransaction, RecurrenceGate: dependencies.RecurrenceGate,
		CareOfferingGuard: dependencies.CareOfferingGuard, Today: today, ClosingDayNotices: dependencies.ClosingDayNotices,
	}, dependencies.Observe)
}

// writeTransaction joins the ambient tenant transaction or opens one, so the recurrence gate always holds a transaction lock.
func writeTransaction(ctx context.Context, fn func(context.Context) error) error {
	return postgres.WriteTransactionBinding(ctx, fn, tenant.WithinCurrentTenant)
}

// SchoolVacation is one vacation window the demo seed stores (ADR 0298).
type SchoolVacation = schoolcalendar.SchoolVacation

// NewSchoolVacations composes the school vacations (#5345) over the ambient transaction and the OpenHolidays API at sourceURL ("" is the public API); without federalState only the sync, nil today is the Berlin day.
func NewSchoolVacations(federalState func(context.Context) (string, error), sourceURL string, today func() string) (schoolcalendar.SchoolVacationOwner, error) {
	if today == nil {
		today = application.BerlinDay(time.Now)
	}
	return application.NewSchoolVacations(application.SchoolVacationDependencies{
		Store: postgres.NewSchoolVacationStore(), Source: openholidays.New(nil, sourceURL, application.SchoolVacationRegions()).SchoolVacations,
		FederalState: federalState, Today: today, AdminTransaction: tenant.WithinAdmin,
	})
}

// NewTraegerClosingDays builds a Träger's closing days (#4702) in its Träger transaction (ADR 0105) over its schools; notices tells the parents of affected holiday bookings (#6434).
func NewTraegerClosingDays(schools traegercalendar.Schools, notices traegercalendar.HolidayNotices) traegercalendar.ClosingDays {
	return application.NewTraegerClosingDays(postgres.NewTraegerClosingDayStore(), schools, notices)
}

// NewTraegerOpeningChanges builds a Träger's opening changes (#8202) in its Träger transaction (ADR 0105) over its schools; notices tells each named school of a write (#8231), nil tells nobody; today names the push window's day (YYYY-MM-DD).
func NewTraegerOpeningChanges(schools traegercalendar.Schools, notices traegercalendar.OpeningChangeNotices, today func() string) traegercalendar.OpeningChanges {
	return application.NewNoticedTraegerOpeningChanges(postgres.NewTraegerOpeningChangeStore(), schools, notices, today)
}

// NewOpeningChanges composes the opening changes of a school (#7654) over the ambient tenant transaction.
func NewOpeningChanges() schoolcalendar.OpeningChanges {
	return postgres.NewOpeningChangeStore(postgres.NewCompositionDatabase())
}

// NewHolidayClosureEvents composes the notices of ADR 0196 over the caller's school or Träger transaction; today is the root's day clock.
func NewHolidayClosureEvents(today func() calendar.Date) *postgres.HolidayClosureEventStore {
	return postgres.NewHolidayClosureEventStore(postgres.NewCompositionDatabase(), today)
}

// NewHolidayClosureCalendar composes revision-guarded no-care days over the narrow read channel; today is the root's day clock.
func NewHolidayClosureCalendar(holidays ports.HolidayClosureHolidays, today func() calendar.Date) schoolcalendar.HolidayClosureCareCalendar {
	return application.NewHolidayClosureCalendar(NewHolidayClosureEvents(today), holidays)
}
