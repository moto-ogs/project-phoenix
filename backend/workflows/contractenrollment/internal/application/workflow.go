// Package application holds the enrollment of the children of imported care
// contracts (ADR 0309 section 4): the read of the contracts, the plan and
// the enrollment in the school, the binding.
package application

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment/ports"
)

// Workflow serves contractenrollment.Enrollments.
type Workflow struct {
	deps ports.Dependencies
}

var _ contractenrollment.Enrollments = (*Workflow)(nil)

// New builds the workflow; every port is required.
func New(deps ports.Dependencies) (*Workflow, error) {
	if deps.Contracts == nil || deps.SchoolEnrollments == nil || deps.Schools == nil || deps.Children == nil ||
		deps.Access == nil || deps.Runtime == nil || deps.Fingerprint == nil {
		return nil, errors.New("contract enrollment: every port is required")
	}
	return &Workflow{deps: deps}, nil
}

func reviewer(actor contractenrollment.Actor) carecontract.Reviewer {
	return carecontract.Reviewer{OrganizationID: actor.OrganizationID, AccountID: actor.AccountID}
}

// look is what one tenant transaction of the school read: the plan, the
// rows the school's enrollment is asked for, the rows as a preview shows
// them and their fingerprint.
type look struct {
	plan   carecontract.EnrollmentPlan
	inputs []enrollment.ContractEnrollment
	rows   []contractenrollment.EnrollmentRow
	print  string
}

// Preview reads the contracts in the Träger transaction and plans them in
// the school's tenant transaction.
func (w *Workflow) Preview(ctx context.Context, actor contractenrollment.Actor, schoolID int64) (contractenrollment.EnrollmentPreview, error) {
	preview := contractenrollment.EnrollmentPreview{SchoolID: ident.ID(schoolID), Rows: []contractenrollment.EnrollmentRow{}}
	read, err := w.contracts(ctx, actor, schoolID)
	if err != nil {
		return preview, err
	}
	var seen look
	err = w.deps.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
		var err error
		seen, err = w.look(ctx, actor, read)
		return err
	})
	if err != nil {
		return preview, err
	}
	preview.Rows, preview.Counts, preview.Fingerprint = seen.rows, countRows(seen.rows), seen.print
	return preview, nil
}

// Run plans again in the school's tenant transaction, hands every ready row
// of the confirmed preview to the school's enrollment there, and binds what
// it confirmed in a Träger transaction of its own. A run that stops between
// the two leaves the children enrolled and the contracts unbound; the next
// run finds the enrollments and binds.
func (w *Workflow) Run(ctx context.Context, actor contractenrollment.Actor, schoolID int64, fingerprint string) (contractenrollment.EnrollmentRun, error) {
	run := contractenrollment.EnrollmentRun{SchoolID: ident.ID(schoolID), Rows: []contractenrollment.EnrollmentRow{}}
	read, err := w.contracts(ctx, actor, schoolID)
	if err != nil {
		return run, err
	}
	var seen look
	answers := enrollmentAnswers{}
	err = w.deps.Runtime.WithinSchool(ctx, schoolID, func(ctx context.Context) error {
		var err error
		if seen, err = w.look(ctx, actor, read); err != nil {
			return err
		}
		if fingerprint == "" || seen.print != fingerprint {
			return contractenrollment.ErrPreviewChanged
		}
		if len(seen.inputs) == 0 {
			return nil
		}
		results, err := w.deps.SchoolEnrollments.EnrollContractChildren(ctx, seen.inputs)
		answers = answersOf(results)
		return err
	})
	if err != nil {
		return run, err
	}
	bound, err := w.bind(ctx, actor, schoolID, bindingsOf(seen.plan, answers))
	if err != nil {
		return run, err
	}
	run.Rows = runRows(seen, answers, bound)
	run.Counts = countRows(run.Rows)
	return run, nil
}

// Unbind takes the application child off a bound imported contract in a
// Träger transaction. It reads and writes nothing of the school.
func (w *Workflow) Unbind(ctx context.Context, actor contractenrollment.Actor, contractID, requestChildID int64) error {
	return w.deps.Runtime.WithinTraeger(ctx, actor.OrganizationID, func(ctx context.Context) error {
		_, err := w.deps.Contracts.UnbindApplication(ctx, reviewer(actor), contractID, requestChildID)
		return err
	})
}

// contracts reads the imported contracts of a school of the Träger in the
// Träger transaction.
func (w *Workflow) contracts(ctx context.Context, actor contractenrollment.Actor, schoolID int64) (carecontract.EnrollmentRead, error) {
	schools, err := w.deps.Schools.TraegerSchoolIDs(ctx, actor.OrganizationID)
	if err != nil {
		return carecontract.EnrollmentRead{}, err
	}
	if !slices.Contains(schools, schoolID) {
		return carecontract.EnrollmentRead{}, carecontract.ErrSchoolOutsideTraeger
	}
	var read carecontract.EnrollmentRead
	err = w.deps.Runtime.WithinTraeger(ctx, actor.OrganizationID, func(ctx context.Context) error {
		var err error
		read, err = w.deps.Contracts.EnrollmentContracts(ctx, reviewer(actor), schoolID)
		return err
	})
	return read, err
}

// look plans the contracts in the tenant transaction of the school the
// caller holds, asks the school's enrollment what it would do with each
// ready row, reads the child records the rows name and writes the read into
// the access log of the school.
func (w *Workflow) look(ctx context.Context, actor contractenrollment.Actor, read carecontract.EnrollmentRead) (look, error) {
	plan, err := w.deps.Contracts.EnrollmentPlans(ctx, read)
	if err != nil {
		return look{}, err
	}
	seen := look{plan: plan, inputs: enrollmentInputs(plan, actor.AccountID)}
	answers := enrollmentAnswers{}
	if len(seen.inputs) > 0 {
		checks, err := w.deps.SchoolEnrollments.CheckContractChildren(ctx, seen.inputs)
		if err != nil {
			return look{}, err
		}
		answers = answersOf(checks)
	}
	contracts, students := planSubjects(plan)
	children := map[int64]ports.Child{}
	if len(students) > 0 {
		found, err := w.deps.Children.SchoolChildren(ctx, students)
		if err != nil {
			return look{}, err
		}
		for _, child := range found {
			children[child.StudentID] = child
		}
	}
	seen.rows = previewRows(plan, answers, children)
	seen.print = w.fingerprint(plan, seen.rows)
	return seen, w.deps.Access.RecordAccess(ctx, ports.SchoolRead{OrganizationID: actor.OrganizationID, AccountID: actor.AccountID,
		ContractIDs: contracts, StudentIDs: students})
}

// bind binds the contracts the school's enrollment confirmed, in a Träger
// transaction, and answers what the binding did with each.
func (w *Workflow) bind(ctx context.Context, actor contractenrollment.Actor, schoolID int64, bindings []carecontract.ApplicationBinding) (map[int64]string, error) {
	bound := map[int64]string{}
	if len(bindings) == 0 {
		return bound, nil
	}
	err := w.deps.Runtime.WithinTraeger(ctx, actor.OrganizationID, func(ctx context.Context) error {
		results, err := w.deps.Contracts.BindApplications(ctx, reviewer(actor), schoolID, bindings)
		for _, result := range results {
			bound[result.ContractID.Int64()] = result.Status
		}
		return err
	})
	return bound, err
}

// fingerprint names what the office confirms: the plan with what each ready
// row was proved on, and the rows as the preview shows them, the child
// records included.
func (w *Workflow) fingerprint(plan carecontract.EnrollmentPlan, rows []contractenrollment.EnrollmentRow) string {
	encoded, _ := json.Marshal([]any{plan.SchoolID, plan.Rows, rows})
	return w.deps.Fingerprint(encoded)
}
