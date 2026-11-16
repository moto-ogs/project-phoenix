package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/ports"
)

// demoSchoolDatabaseBatch bounds one run. The demo process runs hourly; a
// larger backlog takes several runs.
const demoSchoolDatabaseBatch = 10

// DemoSchoolDatabases erases retired demo schools from the database (#5559).
type DemoSchoolDatabases struct{ store ports.DemoSchoolDatabaseStore }

func NewDemoSchoolDatabases(store ports.DemoSchoolDatabaseStore) (*DemoSchoolDatabases, error) {
	if store == nil {
		return nil, errors.New("demo school databases: database required")
	}
	return &DemoSchoolDatabases{store: store}, nil
}

// EraseRetiredDemoSchoolDatabases erases each due school on its own, then
// each Demo-Träger whose last school is gone (ADR 0271). Only an erased
// school or Träger counts. A busy one waits for the next run without failing
// it; a failed one is an error of the run, so the run never reports success
// over a school or Träger it could not erase.
func (d *DemoSchoolDatabases) EraseRetiredDemoSchoolDatabases(ctx context.Context) (int, int, error) {
	schools, err := d.store.DueDemoSchoolDatabases(ctx, demoSchoolDatabaseBatch)
	if err != nil {
		return 0, 0, err
	}
	var run demoErasureRun
	for _, id := range schools {
		status, code, err := d.store.EraseDemoSchoolDatabase(ctx, id)
		run.note("demo school", id, status, code, err)
	}
	// Erased schools free their Träger in the same run.
	traegers, err := d.store.DueDemoTraegers(ctx, demoSchoolDatabaseBatch)
	if err != nil {
		return run.erased, run.busy, errors.Join(append(run.failed, err)...)
	}
	for _, id := range traegers {
		status, code, err := d.store.EraseDemoTraeger(ctx, id)
		run.note("demo Träger", id, status, code, err)
	}
	return run.erased, run.busy, errors.Join(run.failed...)
}

// demoErasureRun counts the outcomes of one run.
type demoErasureRun struct {
	erased, busy int
	failed       []error
}

func (r *demoErasureRun) note(kind string, id int64, status, code string, err error) {
	switch {
	case err != nil:
		r.failed = append(r.failed, fmt.Errorf("%s %d: not erased, retried next run: %w", kind, id, err))
	case status == ports.DemoSchoolErased:
		r.erased++
	case status == ports.DemoSchoolBusy:
		r.busy++
	case status == ports.DemoSchoolNotDue:
	default:
		r.failed = append(r.failed, fmt.Errorf("%s %d: database erasure %s (SQLSTATE %q), retried next run", kind, id, status, code))
	}
}

// DemoSchoolErasure erases retired demo schools: their files first (#5544),
// then their database rows (#5559).
type DemoSchoolErasure struct {
	*DemoSchoolFiles
	*DemoSchoolDatabases
}

func NewDemoSchoolErasure(fileStore ports.DemoSchoolFileStore, databaseStore ports.DemoSchoolDatabaseStore, files organizationtenancy.ErasureFiles) (*DemoSchoolErasure, error) {
	fileErasure, err := NewDemoSchoolFiles(fileStore, files)
	if err != nil {
		return nil, err
	}
	databases, err := NewDemoSchoolDatabases(databaseStore)
	if err != nil {
		return nil, err
	}
	return &DemoSchoolErasure{DemoSchoolFiles: fileErasure, DemoSchoolDatabases: databases}, nil
}
