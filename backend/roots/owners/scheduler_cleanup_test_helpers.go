//go:build testhooks

package owners

import (
	"context"
	"log/slog"
	"time"

	securityRuntimeCompose "github.com/moto-ogs/project-phoenix/modules/securityruntime/compose"
	"github.com/spf13/viper"

	auditCompose "github.com/moto-ogs/project-phoenix/modules/auditlog/compose"
	schedulerCompose "github.com/moto-ogs/project-phoenix/modules/schedulerruntime/compose"
	schedulerPorts "github.com/moto-ogs/project-phoenix/modules/schedulerruntime/ports"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	settingsCompose "github.com/moto-ogs/project-phoenix/modules/settings/compose"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/compose/presenceservice"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewSchedulerCleanupTestDependencies binds the same directory, settings,
// presence cleanup, ledger and tenant runtime as the Worker, without unrelated jobs.
func NewSchedulerCleanupTestDependencies(db transactionruntime.Database, unit tenant.UnitOfWork, now func() time.Time) (schedulerPorts.WorkerDependencies, error) {
	// One clock for the whole composition (ADR 0262): the retention selection
	// in Presence and the deletion in the cleanup read the same instant. A
	// test without one runs on the wall clock.
	if now == nil {
		now = time.Now
	}
	settings, err := NewSettingsTestModule(db, unit)
	if err != nil {
		return schedulerPorts.WorkerDependencies{}, err
	}
	resolver, err := schedulerSettings(settings.Settings)
	if err != nil {
		return schedulerPorts.WorkerDependencies{}, err
	}
	schools, err := NewOrganizationTenancy(db)
	if err != nil {
		return schedulerPorts.WorkerDependencies{}, err
	}
	presence, err := presenceCompose.New(presenceCompose.Dependencies{DB: db.Pool(), Observe: func(presenceCompose.Observation) {}, Now: now})
	if err != nil {
		return schedulerPorts.WorkerDependencies{}, err
	}
	records := ComposePresenceSessionRecords(presenceCompose.SessionRecordDependencies{
		DB: db.Pool(), Now: now,
	})
	_, supervisors := presenceCompose.SessionRepositories(records)
	audit, err := auditCompose.NewTenantPersistence(db.Pool(), auditTestClock(now))
	if err != nil {
		return schedulerPorts.WorkerDependencies{}, err
	}
	command, err := auditCompose.NewCommand(NewTestAuditStoreAt(db, auditTestClock(now)), func(auditCompose.AppendObservation) {}, auditTestClock(now))
	if err != nil {
		return schedulerPorts.WorkerDependencies{}, err
	}
	runtime, err := schedulerCompose.NewTenantRuntime(unit)
	if err != nil {
		return schedulerPorts.WorkerDependencies{}, err
	}
	cleanup := presenceservice.NewPresenceCleanup(presence, supervisors, NewDeletionAudit(audit.DataDeletion),
		settingsCompose.PresenceSettings(settings.Settings), now)
	return schedulerPorts.WorkerDependencies{
		Logger: slog.New(slog.DiscardHandler), Now: now,
		SchoolRepo: schedulerTenantDirectory{schools: schools}, Settings: resolver,
		TenantRuntime: runtime, CleanupRuns: schedulerCompose.NewCleanupRunLedger(),
		ActiveCleanup: newSchedulerPresenceCleanup(cleanup),
		RetentionLog: func(ctx context.Context, kind string, outcome schedulerPorts.RetentionOutcome) error {
			return command.LogRetention(ctx, kind, outcome.Deleted, outcome.RetentionDays)
		},
	}, nil
}

// NewSchedulerFileRetentionTestDependencies composes real retention and file
// recovery over a private upload directory, without starting unrelated jobs.
func NewSchedulerFileRetentionTestDependencies(db transactionruntime.Database, unit tenant.UnitOfWork, now func() time.Time, publicDir string) (schedulerPorts.WorkerDependencies, error) {
	deps, err := NewSchedulerCleanupTestDependencies(db, unit, now)
	if err != nil {
		return deps, err
	}
	// The retention steps stay on the real clock: the ones these tests run
	// decide on the database clock (ADR 0281, Nachtrag), and a pinned clock
	// would reach the Care Plan composition of the steps.
	audit, _, steps, err := NewRetentionTestOwnersAt(db, unit, time.Now)
	if err != nil {
		return deps, err
	}
	deps.RetentionSteps = steps
	deps.RetentionLog = func(ctx context.Context, kind string, outcome schedulerPorts.RetentionOutcome) error {
		return audit.LogRetention(ctx, kind, outcome.Deleted, outcome.RetentionDays)
	}
	membership, err := NewSchoolMembership(db)
	if err != nil {
		return deps, err
	}
	// Recovery reads Workforce records and offboarded membership IDs; it does
	// not invoke personnel edits or their audit trail.
	bankData, err := securityRuntimeCompose.NewBankDataCipher(viper.GetString("bank_data_keys"), "")
	if err != nil {
		return deps, err
	}
	documents, err := workforceCompose.NewStaffAdmin(workforceCompose.StaffAdminDependencies{
		DB: db.Pool(), Subjects: staffAdminSubjects{membership: membership}, Audit: staffAdminAudit{}, Allows: securityruntime.HasPermission,
		BankData: bankData,
	})
	if err != nil {
		return deps, err
	}
	queue, err := workforceCompose.NewDocumentCleanup(db.Pool(), nil)
	if err != nil {
		return deps, err
	}
	deps.StaffDocumentCleaner, err = workforceCompose.NewStaffDocumentFileRecovery(documents, queue, cleanupTestUploads{dir: publicDir}, deps.Logger)
	return deps, err
}

type cleanupTestUploads struct{ dir string }

func (u cleanupTestUploads) PublicDir() (string, error) { return u.dir, nil }

// auditTestClock is now, or the real clock for callers that pass none.
func auditTestClock(now func() time.Time) func() time.Time {
	if now == nil {
		return time.Now
	}
	return now
}
