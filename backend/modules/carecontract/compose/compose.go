// Package compose builds the Betreuungsvertrag (ADR 0088, ADR 0153) over the ports the root binds.
package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/adapters/rendering"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/application"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type (
	ContractPorts = application.ContractPorts
	IntakePorts   = application.IntakePorts
	ImportPorts   = application.ImportPorts
)

// NewContracts builds the contracts of the Träger-Büro; the reads open own units for each school's access log. now is the root's clock (ADR 0239), nil the real one.
func NewContracts(ports ContractPorts, now func() time.Time) carecontract.Contracts {
	return application.NewContracts(postgres.NewStore(), rendering.NewRenderer(), ports, application.Clock{Now: now}, NewContractVersions())
}

// NewContractVersions reads the versions in force and the recipients for the billing (#4681, #4684) in the caller's Träger unit.
func NewContractVersions() carecontract.ContractBilling {
	return application.NewBillingReads(postgres.NewStore())
}

// NewContractChanges builds the office's decision of the parents' changes (#5979); it opens its own units.
func NewContractChanges(ports carecontract.ChangePorts) carecontract.ContractChangeDecisions {
	return application.NewContractChanges(postgres.NewStore(), ports)
}

// NewIntake builds the creation of contracts from the accepted applications and the offerings' templates; today is the root's day clock (ADR 0239).
func NewIntake(ports IntakePorts, today func() calendar.Date) carecontract.Intake {
	return application.NewIntake(postgres.NewStore(), ports, today)
}

// NewContractImports builds the import of existing contracts from a file (#4723); it opens its own units. today: see NewIntake.
func NewContractImports(ports ImportPorts, today func() calendar.Date) carecontract.ContractImports {
	return application.NewContractImports(postgres.NewStore(), ports, today)
}

// NewConclusion builds the conclusion at the acceptance (Weg b, #4680); it opens its own units. now: see NewContracts.
func NewConclusion(contracts ContractPorts, intake IntakePorts, now func() time.Time) carecontract.Conclusion {
	clock := application.Clock{Now: now}
	return application.NewConclusions(application.NewIntake(postgres.NewStore(), intake, calendar.CalendarDateClock(now)),
		application.NewContracts(postgres.NewStore(), rendering.NewRenderer(), contracts, clock, NewContractVersions()), clock)
}

// NewInbox builds the parents' inbox in the parents portal's Träger unit; h, its school holidays, may be nil where it lists nothing. now: see NewContracts.
func NewInbox(h carecontract.SchoolHolidays, now func() time.Time) *application.Inbox {
	return application.NewInbox(postgres.NewStore(), h, application.Clock{Now: now})
}

// NewContractMailRenderer renders a contract mail for Delivery's worker.
func NewContractMailRenderer() carecontract.ContractMailRenderer {
	return application.RenderContractMail
}

// NewBookedCare builds the school's read of the booked care of its
// contracts, the Soll of Soll und Ist (#4683, ADR 0156). It reads in the
// tenant transaction of the school the caller holds.
func NewBookedCare() carecontract.BookedCare { return postgres.NewBookedCare() }

// NewOverrunEvaluations builds the evaluation of overruns over the schools
// of the Träger (#4683, ADR 0156); it opens its own units on the day today.
func NewOverrunEvaluations(ports OverrunPorts, today func() calendar.Date) carecontract.OverrunEvaluations {
	return application.NewOverruns(application.OverrunPorts(ports), today)
}

type OverrunPorts struct {
	Schools   carecontract.TraegerSchools
	CareTimes carecontract.SchoolCareTimes
	Access    carecontract.SchoolAccessLog
	Runtime   carecontract.Runtime
}

// NewContractRetention reads and deletes contracts for the retention of the
// Belege of a Träger (#4720, ADR 0184) in the caller's administrative unit.
func NewContractRetention() carecontract.ContractRetention { return postgres.NewContractRetention() }
