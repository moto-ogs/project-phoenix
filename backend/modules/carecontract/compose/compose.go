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
	ContractPorts   = application.ContractPorts
	IntakePorts     = application.IntakePorts
	ImportPorts     = application.ImportPorts
	CorrectionPorts = application.CorrectionPorts
	// ChildLinkPorts are the ports of the link of imported contracts to child records (#7760).
	ChildLinkPorts = application.ChildLinkPorts
	// EnrollmentPorts are the school reads of the enrollment of the children of imported contracts (#7760, ADR 0309).
	EnrollmentPorts = application.EnrollmentPorts
)

// NewContracts builds the contracts of the Träger-Büro; the reads open own units for each school's access log. now is the root's clock (ADR 0239), nil the real one.
func NewContracts(ports ContractPorts, now func() time.Time) carecontract.Contracts {
	return application.NewContracts(storeOn(now), rendering.NewRenderer(), ports, application.Clock{Now: now}, NewContractVersions())
}

// storeOn builds the store on the Berlin day of now.
func storeOn(now func() time.Time) *postgres.Store {
	return postgres.NewStore(calendar.CalendarDateClock(now))
}

// NewContractVersions reads the versions in force and the recipients for the billing (#4681, #4684) in the caller's Träger unit; it reads no current version (store without day clock). NewContractBilling also names each recipient's parents account address of today (#8215).
func NewContractVersions() carecontract.ContractBilling { return NewContractBilling(nil) }
func NewContractBilling(accounts carecontract.AccountEmails) carecontract.ContractBilling {
	return application.NewBillingReads(postgres.NewStore(nil), accounts)
}

// NewContractChanges builds the office's decision of the parents' changes (#5979); it opens its own units and reads no current version (store without day clock).
func NewContractChanges(ports carecontract.ChangePorts) carecontract.ContractChangeDecisions {
	return application.NewContractChanges(postgres.NewStore(nil), ports)
}

// NewIntake builds the creation of contracts from the accepted applications and the offerings' templates; today is the root's day clock (ADR 0239).
func NewIntake(ports IntakePorts, today func() calendar.Date) carecontract.Intake {
	return application.NewIntake(postgres.NewStore(today), ports, today)
}

// NewContractImports builds the import of existing contracts from a file (#4723), NewContractCorrections the correction of those contracts (#7767, store without day clock); both open their own units. today: see NewIntake.
func NewContractImports(ports ImportPorts, today func() calendar.Date) carecontract.ContractImports {
	return application.NewContractImports(postgres.NewStore(today), ports, today)
}
func NewContractCorrections(ports CorrectionPorts, today func() calendar.Date) carecontract.ContractCorrections {
	return application.NewContractCorrections(postgres.NewStore(nil), ports, today)
}

// NewContractChildLinks builds the link of imported contracts to child records (#7760); it opens its own units. today: see NewIntake.
func NewContractChildLinks(ports ChildLinkPorts, today func() calendar.Date) carecontract.ContractChildLinks {
	return application.NewContractChildLinks(postgres.NewStore(today), ports, today)
}

// NewContractEnrollments builds the plan and the binding of the enrollment of the children of imported contracts (#7760, ADR 0309); it opens no unit, the caller runs each step in its own. today: see NewIntake.
func NewContractEnrollments(ports EnrollmentPorts, today func() calendar.Date) carecontract.ContractEnrollments {
	return application.NewContractEnrollments(postgres.NewStore(today), ports, today)
}

// NewConclusion builds the conclusion at the acceptance (Weg b, #4680); it opens its own units. now: see NewContracts.
func NewConclusion(contracts ContractPorts, intake IntakePorts, now func() time.Time) carecontract.Conclusion {
	clock, today := application.Clock{Now: now}, calendar.CalendarDateClock(now)
	return application.NewConclusions(application.NewIntake(postgres.NewStore(today), intake, today),
		application.NewContracts(postgres.NewStore(today), rendering.NewRenderer(), contracts, clock, NewContractVersions()), clock)
}

// NewInbox builds the parents' inbox in the parents portal's Träger unit; h, its school holidays, may be nil where it lists nothing. now: see NewContracts.
func NewInbox(h carecontract.SchoolHolidays, now func() time.Time) *application.Inbox {
	return application.NewInbox(storeOn(now), h, application.Clock{Now: now})
}

// NewContractMailRenderer renders a contract mail for Delivery's worker.
func NewContractMailRenderer() carecontract.ContractMailRenderer {
	return application.RenderContractMail
}

// NewBookedCare (the Soll of Soll und Ist, #4683, ADR 0156) and NewApplicationContracts (#4788) read the school's contracts in its tenant transaction.
func NewBookedCare() carecontract.BookedCare                     { return postgres.NewBookedCare() }
func NewApplicationContracts() carecontract.ApplicationContracts { return postgres.NewBookedCare() }

// NewOverrunEvaluations evaluates the overruns of the Träger's schools (#4683, ADR 0156) in own units on the day today.
func NewOverrunEvaluations(ports OverrunPorts, today func() calendar.Date) carecontract.OverrunEvaluations {
	return application.NewOverruns(application.OverrunPorts(ports), today)
}

type OverrunPorts struct {
	Schools   carecontract.TraegerSchools
	CareTimes carecontract.SchoolCareTimes
	Access    carecontract.SchoolAccessLog
	Runtime   carecontract.Runtime
}

// NewContractRetention reads and deletes contracts for the retention of the Belege of a Träger (#4720, ADR 0184) in the caller's administrative unit.
func NewContractRetention() carecontract.ContractRetention { return postgres.NewContractRetention() }
