package application

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The enrollment of the children of imported contracts (#7760, ADR 0308):
// the read of the contracts in the Träger transaction, the plan in the
// school's tenant transaction and the binding in the Träger transaction. The
// caller opens each unit; nothing here does.

const viewEnrollmentPlan = "enrollment_plan"

// EnrollmentStore persists what the enrollment of imported contracts reads
// and writes, in the Träger transaction of organizationID.
type EnrollmentStore interface {
	// EnrollmentContracts reads the imported contracts of the school, all or
	// only ids, with their effective versions; forUpdate locks their rows.
	EnrollmentContracts(ctx context.Context, organizationID, schoolID int64, ids []int64, forUpdate bool) ([]carecontract.EnrollmentContract, error)
	ContractChildren(ctx context.Context, organizationID int64, schoolIDs []int64) ([]ports.ContractChild, error)
	// LockChildLinks is the lock a link run and a creation of a contract
	// take: under it nothing else decides what covers a child.
	LockChildLinks(ctx context.Context, organizationID int64) error
	// BindContractApplications binds each imported contract without an
	// application child that still has the child record named, and answers
	// the contracts it bound; ErrContractExists for an application child
	// that has a contract.
	BindContractApplications(ctx context.Context, organizationID int64, bindings []ports.ApplicationBinding) ([]int64, error)
	InsertEvents(ctx context.Context, organizationID int64, events []Event) error
}

// EnrollmentPorts are the root-bound reads of the plan in the school's
// tenant transaction.
type EnrollmentPorts struct {
	Applications carecontract.SchoolApplications
	Bookings     carecontract.SchoolBookings
}

// ContractEnrollments serves carecontract.ContractEnrollments.
type ContractEnrollments struct {
	store EnrollmentStore
	ports EnrollmentPorts
	today func() calendar.Date
}

var _ carecontract.ContractEnrollments = (*ContractEnrollments)(nil)

func NewContractEnrollments(store EnrollmentStore, ports EnrollmentPorts, today func() calendar.Date) *ContractEnrollments {
	if store == nil || ports.Applications == nil || ports.Bookings == nil || today == nil {
		panic("care contract: the store, the applications, the bookings and the clock are required")
	}
	return &ContractEnrollments{store: store, ports: ports, today: today}
}

// EnrollmentContracts reads the imported contracts of the school and the
// application children with a contract there, and records the read.
func (e *ContractEnrollments) EnrollmentContracts(ctx context.Context, reviewer carecontract.Reviewer, schoolID int64) (carecontract.EnrollmentRead, error) {
	read := carecontract.EnrollmentRead{SchoolID: schoolID, Contracts: []carecontract.EnrollmentContract{}, ContractedChildren: []int64{}}
	if err := checkReviewer(reviewer); err != nil {
		return read, err
	}
	if schoolID <= 0 {
		return read, carecontract.ErrSchoolOutsideTraeger
	}
	contracts, err := e.store.EnrollmentContracts(ctx, reviewer.OrganizationID, schoolID, nil, false)
	if err != nil {
		return read, err
	}
	children, err := e.store.ContractChildren(ctx, reviewer.OrganizationID, []int64{schoolID})
	if err != nil {
		return read, err
	}
	read.Contracts = contracts
	for _, child := range children {
		if child.RequestChildID != nil {
			read.ContractedChildren = append(read.ContractedChildren, *child.RequestChildID)
		}
	}
	return read, trail(ctx, e.store, reviewer.OrganizationID, reviewer.AccountID, 0, 0, ActionRead,
		map[string]any{"view": viewEnrollmentPlan, "school_id": schoolID, "rows": len(contracts)})
}

// EnrollmentPlans answers every contract of the read in the tenant
// transaction of its school.
func (e *ContractEnrollments) EnrollmentPlans(ctx context.Context, read carecontract.EnrollmentRead) (carecontract.EnrollmentPlan, error) {
	plan := carecontract.EnrollmentPlan{SchoolID: ident.ID(read.SchoolID), Rows: []carecontract.EnrollmentPlanRow{}}
	students := []int64{}
	for _, contract := range read.Contracts {
		if contract.RequestChildID == nil && contract.StudentID != nil {
			students = append(students, *contract.StudentID)
		}
	}
	school := schoolRead{school: carecontract.School{ID: read.SchoolID}, offerings: map[int64]carecontract.Offering{}}
	applications := map[int64][]carecontract.Application{}
	if len(students) > 0 {
		var err error
		if applications, err = e.readSchool(ctx, &school, students); err != nil {
			return plan, fmt.Errorf("care contract: read school %d: %w", read.SchoolID, err)
		}
	}
	contracted := make(map[int64]bool, len(read.ContractedChildren))
	for _, child := range read.ContractedChildren {
		contracted[child] = true
	}
	today := e.today()
	for _, contract := range read.Contracts {
		var of []carecontract.Application
		if contract.StudentID != nil {
			of = applications[*contract.StudentID]
		}
		row := planEnrollmentRow(school, contract, of, contracted, today)
		countEnrollmentRow(&plan.Counts, row)
		plan.Rows = append(plan.Rows, row)
	}
	return plan, nil
}

// readSchool reads the care offerings of the school with their phases and
// the accepted applications of the child records with their bookings, by
// child record: a fixed number of reads, however many contracts.
func (e *ContractEnrollments) readSchool(ctx context.Context, school *schoolRead, students []int64) (map[int64][]carecontract.Application, error) {
	offerings, err := e.ports.Bookings.Offerings(ctx, nil)
	if err != nil {
		return nil, err
	}
	if len(offerings) > 0 {
		if offerings, err = e.ports.Applications.NamePhases(ctx, offerings); err != nil {
			return nil, err
		}
	}
	for _, offering := range offerings {
		school.offerings[offering.ID] = offering
	}
	accepted, err := e.ports.Applications.AcceptedApplications(ctx, nil)
	if err != nil {
		return nil, err
	}
	ids := []int64{}
	accepted = slices.DeleteFunc(accepted, func(application carecontract.Application) bool {
		return application.StudentID == nil || !slices.Contains(students, *application.StudentID)
	})
	for _, application := range accepted {
		ids = append(ids, application.RequestChildID)
	}
	byStudent := map[int64][]carecontract.Application{}
	if len(ids) == 0 {
		return byStudent, nil
	}
	bookings, err := e.ports.Bookings.Bookings(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, application := range accepted {
		application.Bookings = bookings[application.RequestChildID]
		byStudent[*application.StudentID] = append(byStudent[*application.StudentID], application)
	}
	return byStudent, nil
}

func countEnrollmentRow(counts *carecontract.EnrollmentCounts, row carecontract.EnrollmentPlanRow) {
	switch row.Status {
	case carecontract.EnrollmentReady:
		counts.Ready++
	case carecontract.EnrollmentDone:
		counts.Done++
	case carecontract.EnrollmentUnlinked:
		counts.Unlinked++
	case carecontract.EnrollmentHeld:
		counts.Held++
	}
}

// BindApplications binds each contract to its application child under the
// lock of the Träger's links.
func (e *ContractEnrollments) BindApplications(ctx context.Context, reviewer carecontract.Reviewer, schoolID int64,
	bindings []carecontract.ApplicationBinding) ([]carecontract.ApplicationBindingResult, error) {
	results := make([]carecontract.ApplicationBindingResult, len(bindings))
	if err := checkReviewer(reviewer); err != nil {
		return nil, err
	}
	if len(bindings) == 0 {
		return results, nil
	}
	// The lock a link run and a creation of a contract take: neither changes
	// the child record of a contract or gives the application child another
	// contract until this transaction ends.
	if err := e.store.LockChildLinks(ctx, reviewer.OrganizationID); err != nil {
		return nil, err
	}
	ids := make([]int64, len(bindings))
	for i, binding := range bindings {
		ids[i] = binding.ContractID.Int64()
	}
	contracts, err := e.store.EnrollmentContracts(ctx, reviewer.OrganizationID, schoolID, ids, true)
	if err != nil {
		return nil, err
	}
	children, err := e.store.ContractChildren(ctx, reviewer.OrganizationID, []int64{schoolID})
	if err != nil {
		return nil, err
	}
	check := newBindingCheck(contracts, children)
	bind, events := []ports.ApplicationBinding{}, []Event{}
	for i, binding := range bindings {
		results[i] = carecontract.ApplicationBindingResult{ContractID: binding.ContractID, Status: check.decide(binding)}
		if results[i].Status != carecontract.BindingBound {
			continue
		}
		contractID, school := binding.ContractID.Int64(), schoolID
		bind = append(bind, ports.ApplicationBinding{ContractID: contractID, StudentID: binding.StudentID.Int64(),
			RequestChildID: binding.RequestChildID.Int64()})
		events = append(events, Event{ContractID: &contractID, SchoolID: &school, AccountID: reviewer.AccountID,
			Action: ports.ActionBindApplication, Details: map[string]any{
				"request_child_id": binding.RequestChildID.Int64(), "student_id": binding.StudentID.Int64()}})
	}
	return results, e.storeBindings(ctx, reviewer.OrganizationID, bind, events)
}

// storeBindings binds the contracts and records each. The checks ran under
// the row locks, so a contract the statement leaves out is a fault.
func (e *ContractEnrollments) storeBindings(ctx context.Context, organizationID int64, bind []ports.ApplicationBinding, events []Event) error {
	if len(bind) == 0 {
		return nil
	}
	bound, err := e.store.BindContractApplications(ctx, organizationID, bind)
	if err != nil {
		return err
	}
	if len(bound) != len(bind) {
		return fmt.Errorf("care contract: bound %d of %d contracts under their row locks", len(bound), len(bind))
	}
	if err := e.store.InsertEvents(ctx, organizationID, events); err != nil {
		return fmt.Errorf("care contract: record the bindings: %w", err)
	}
	return nil
}

// bindingCheck is what the bindings of one call are decided against: the
// locked contracts and the application children that have a contract, the
// ones this call binds included.
type bindingCheck struct {
	contracts  map[int64]carecontract.EnrollmentContract
	contracted map[int64]int64
}

func newBindingCheck(contracts []carecontract.EnrollmentContract, children []ports.ContractChild) *bindingCheck {
	check := &bindingCheck{contracts: make(map[int64]carecontract.EnrollmentContract, len(contracts)), contracted: map[int64]int64{}}
	for _, contract := range contracts {
		check.contracts[contract.ID] = contract
	}
	for _, child := range children {
		if child.RequestChildID != nil {
			check.contracted[*child.RequestChildID] = child.ContractID
		}
	}
	return check
}

// decide answers one binding: done for a contract bound to the named
// application child already, changed for one that is no longer the imported,
// active, unbound contract with the child record and the timeline of the
// plan, or whose application child has another contract, else bound.
func (c *bindingCheck) decide(binding carecontract.ApplicationBinding) string {
	contract, known := c.contracts[binding.ContractID.Int64()]
	requestChild := binding.RequestChildID.Int64()
	switch {
	case !known || requestChild <= 0:
		return carecontract.BindingChanged
	case contract.RequestChildID != nil && *contract.RequestChildID == requestChild:
		return carecontract.BindingDone
	case contract.RequestChildID != nil, contract.Status != carecontract.StatusActive,
		contract.StudentID == nil || *contract.StudentID != binding.StudentID.Int64(),
		timelineToken(contract.Versions) != binding.Timeline, c.contracted[requestChild] != 0:
		return carecontract.BindingChanged
	}
	c.contracted[requestChild] = contract.ID
	return carecontract.BindingBound
}
