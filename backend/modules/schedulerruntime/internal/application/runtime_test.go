package application

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/schedulerruntime/ports"

	"github.com/moto-ogs/project-phoenix/modules/schedulerruntime/internal/adapters/jobruntime"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// mustTenantRuntime binds a composed tenant runtime through the Worker's
// production adapter.
func mustTenantRuntime(runtime jobruntime.Runtime, err error) ports.TenantRuntime {
	if err != nil {
		panic(err)
	}
	return runtime
}

// unitTenantRuntime is the database-less runtime of the test support.
func unitTenantRuntime() ports.TenantRuntime {
	return mustTenantRuntime(jobruntime.New(testpkg.PassthroughTenantRuntime()))
}

// scriptedTenantRuntime is the database-less runtime with a scripted tenant
// transaction and retry decision.
func scriptedTenantRuntime(withinTenant func(context.Context, int64, func(context.Context, any) error) error, retryable func(error) bool) ports.TenantRuntime {
	return mustTenantRuntime(jobruntime.New(testpkg.ScriptedTenantRuntime(withinTenant, retryable)))
}

// dbTenantRuntime is the production tenant runtime against the test database.
func dbTenantRuntime(t *testing.T, db *bun.DB) ports.TenantRuntime {
	t.Helper()
	return mustTenantRuntime(jobruntime.New(testpkg.TenantRuntime(t, db)))
}

const schedulerUnitTenantID int64 = 1

// staticTenants supplies the same tenant IDs to the active and cleanup lists.
func staticTenants(ids ...int64) unitTenantDirectory {
	return unitTenantDirectory{list: func(context.Context) ([]int64, error) { return ids, nil }}
}

type unitTenantDirectory struct {
	ports.TenantDirectory
	list func(context.Context) ([]int64, error)
}

func (d unitTenantDirectory) ListActiveTenantIDs(ctx context.Context) ([]int64, error) {
	return d.list(ctx)
}

func (d unitTenantDirectory) ListCleanupTenantIDs(ctx context.Context) ([]int64, error) {
	return d.list(ctx)
}

func (unitTenantDirectory) HoldLiveSchool(context.Context, int64) (bool, error) {
	return true, nil
}

// unitSnapshots supplies opaque handles for tests concerned with a job rather
// than how the settings source resolves or binds a snapshot.
type unitSnapshots struct{}

func (unitSnapshots) ResolveSettingsSnapshots(_ context.Context, tenantIDs []int64, _ []string) (map[int64]ports.SettingsSnapshot, error) {
	snapshots := make(map[int64]ports.SettingsSnapshot, len(tenantIDs))
	for _, id := range tenantIDs {
		snapshots[id] = id
	}
	return snapshots, nil
}

func (unitSnapshots) BindSettingsSnapshot(ctx context.Context, _ ports.SettingsSnapshot) (context.Context, error) {
	return ctx, nil
}

type unitSettings struct {
	ports.SettingsResolver
	unitSnapshots
}

func settingsForSchedulerTest(resolver ports.SettingsResolver) ports.Settings {
	if resolver == nil {
		resolver = registryDefaultSettings{}
	}
	if settings, ok := resolver.(ports.Settings); ok {
		return settings
	}
	return unitSettings{SettingsResolver: resolver}
}

func testEnv(values ...string) func(string) string {
	if len(values)%2 != 0 {
		panic("testEnv requires key/value pairs")
	}
	env := make(map[string]string, len(values)/2)
	for i := 0; i < len(values); i += 2 {
		env[values[i]] = values[i+1]
	}
	return func(key string) string { return env[key] }
}

func TestStopCancelsRunningTaskContexts(t *testing.T) {
	t.Parallel()

	scheduler := newUnitScheduler(nil, nil, nil, nil, nil, nil, slog.Default())
	ctx, cancel := scheduler.taskContext(scheduler.lifecycleContext(), time.Hour)
	defer cancel()

	stopped := make(chan struct{})
	scheduler.wg.Go(func() {

		<-ctx.Done()
		close(stopped)
	})

	scheduler.Stop()

	require.ErrorIs(t, ctx.Err(), context.Canceled)
	select {
	case <-stopped:
	default:
		t.Fatal("scheduler stopped before its task context was cancelled")
	}
}

func newUnitScheduler(
	activeService ports.SessionMaintenance,
	cleanupService ports.PresenceCleanup,
	authService ports.AuthCleanup,
	invitationService ports.InvitationCleaner,
	emailChangeCleaner ports.EmailChangeTokenCleaner,
	operatorInvitationCleaner ports.OperatorInvitationCleaner,
	logger *slog.Logger,
) *Scheduler {
	scheduler := newScheduler(ports.WorkerDependencies{Now: time.Now,
		Logger:                    logger,
		TenantRuntime:             unitTenantRuntime(),
		Active:                    activeService,
		ActiveCleanup:             cleanupService,
		AuthCleanup:               authService,
		InvitationCleanup:         invitationService,
		EmailChangeCleanup:        emailChangeCleaner,
		OperatorInvitationCleanup: operatorInvitationCleaner,
		FeedbackCleaner:           &fakeFeedbackCleaner{},
		Settings:                  settingsForSchedulerTest(nil),
	})
	jobs := scheduler.jobDefinitions()
	required := make([]ports.JobID, 0, len(jobs))
	for _, job := range jobs {
		required = append(required, job.ID())
	}
	registry, err := NewRegistry(required, jobs...)
	if err != nil {
		panic(err)
	}
	scheduler.registry = registry
	// Supply tenant discovery without adding the standalone directory jobs.
	scheduler.schoolRepo = staticTenants(schedulerUnitTenantID)
	return scheduler
}

// unitSchedulerDependencies are the construction inputs of a partial worker fixture.
type unitSchedulerDependencies struct {
	activeService                 ports.SessionMaintenance
	announcementReminderScannedAt map[int64]time.Time
	announcementReminders         ports.ParentAnnouncementReminderCommand
	appointmentReminderScannedAt  map[int64]time.Time
	appointmentReminders          ports.AppointmentReminderCommand
	authCleanup                   ports.AuthCleanup
	autoCheckouter                ports.AutoCheckouter
	autoEnd                       ports.InstanceAutoEnd
	autoStart                     ports.InstanceAutoStart
	bookingConsistency            ports.BookingConsistencyAudit
	mealOrders                    ports.MealOrderSettlement
	breakAutoEnder                ports.BreakAutoEnder
	calendarFeedCleanup           ports.CalendarFeedCleaner
	careExitEffector              ports.CareExitEffector
	cleanupJobs                   []CleanupJob
	cleanupRuns                   ports.CleanupRunLedger
	cleanupService                ports.PresenceCleanup
	done                          chan struct{}
	enrollmentRejectedCleanup     ports.RejectedEnrollmentCleaner
	feedbackCleaner               ports.FeedbackCleaner
	fileStoreCleaner              ports.FileStoreCleaner
	getenv                        func(string) string
	instanceRepo                  ports.DayInstanceReader
	instanceRoomRepo              ports.ExistingRoomReader
	instanceStudentRepo           ports.InstanceCheckoutCloser
	invitationCleanup             ports.InvitationCleaner
	lifecycleCtx                  context.Context
	logger                        *slog.Logger
	materializer                  ports.TimetableMaterializer
	now                           func() time.Time
	outboxWorker                  ports.OutboxWorkerRunner
	overdueBroadcaster            ports.InstanceOverdueBroadcaster
	pwaUsageCleanup               ports.PWAUsageCleanup
	registry                      *Registry
	reminderNotifications         ports.ReminderNotificationTick
	retention                     RetentionRun
	retentionLog                  ports.RetentionLog
	rolloverDeadlineRunner        ports.RolloverDeadlineRunner
	schoolRepo                    ports.TenantDirectory
	settings                      ports.SettingsResolver
	staffDocumentFileCleaner      ports.StaffDocumentFileCleaner
	staffMessageCleanup           ports.StaffMessageCleanup
	stopLifecycle                 context.CancelFunc
	studentChangeLogCleanup       ports.StudentChangeLogCleanup
	studentDocumentFileCleaner    ports.StudentDocumentFileCleaner
	studentLifecycleAudit         ports.StudentLifecycleAuditor
	studentLifecycleRepo          ports.StudentLifecycleRepository
	studentStatusDayRepo          ports.StudentStatusFlagArchiver
	tasks                         map[string]*ScheduledTask
	tenantRuntime                 ports.TenantRuntime
	tenantRuntimeObserver         func(entryPoint, outcome string)
	timeTrackingCleanup           ports.TimeTrackingCleanupService
	timetableBridge               ports.TimetableBridgeCompleter
	timetableCleanup              ports.TimetableCleanup
	unitOfWorkObserver            func(entryPoint, kind, result string, duration time.Duration, retries int)
	workSessionCleanup            ports.WorkSessionCleaner
	workerTracer                  ports.WorkerTracer
}

func unitScheduler(input *unitSchedulerDependencies) *Scheduler {
	configured := newUnitScheduler(nil, nil, nil, nil, nil, nil, input.logger)
	runtime := input.tenantRuntime
	if runtime == nil {
		runtime = configured.tenantRuntime
	}
	directory := input.schoolRepo
	if directory == nil {
		directory = configured.schoolRepo
	}
	registry := input.registry
	if registry == nil {
		registry = configured.registry
	}
	feedbackCleaner := input.feedbackCleaner
	if feedbackCleaner == nil {
		feedbackCleaner = configured.feedbackCleaner
	}
	now := input.now
	if now == nil {
		// A unit test that pins no clock runs on the real one, as before.
		now = time.Now
	}
	retentionLog := input.retentionLog
	if retentionLog == nil {
		retentionLog = func(context.Context, string, ports.RetentionOutcome) error { return nil }
	}
	return &Scheduler{
		retentionCleanupJobs: retentionCleanupJobs{
			feedbackCleaner:     feedbackCleaner,
			pwaUsageCleanup:     input.pwaUsageCleanup,
			staffMessageCleanup: input.staffMessageCleanup,
			retentionLog:        retentionLog,
		},
		activeService:                 input.activeService,
		announcementReminderScannedAt: input.announcementReminderScannedAt,
		announcementReminders:         input.announcementReminders,
		appointmentReminderScannedAt:  input.appointmentReminderScannedAt,
		appointmentReminders:          input.appointmentReminders,
		authCleanup:                   input.authCleanup,
		autoCheckouter:                input.autoCheckouter,
		autoEnd:                       input.autoEnd,
		autoStart:                     input.autoStart,
		bookingConsistency:            input.bookingConsistency,
		mealOrders:                    input.mealOrders,
		breakAutoEnder:                input.breakAutoEnder,
		calendarFeedCleanup:           input.calendarFeedCleanup,
		careExitEffector:              input.careExitEffector,
		cleanupJobs:                   input.cleanupJobs,
		cleanupRuns:                   input.cleanupRuns,
		cleanupService:                input.cleanupService,
		schedulerLifecycle:            schedulerLifecycle{done: input.done, lifecycleCtx: input.lifecycleCtx, stopLifecycle: input.stopLifecycle},
		enrollmentRejectedCleanup:     input.enrollmentRejectedCleanup,
		fileStoreCleaner:              input.fileStoreCleaner,
		getenv:                        input.getenv,
		instanceRepo:                  input.instanceRepo,
		instanceRoomRepo:              input.instanceRoomRepo,
		instanceStudentRepo:           input.instanceStudentRepo,
		invitationCleanup:             input.invitationCleanup,
		logger:                        input.logger,
		materializer:                  input.materializer,
		now:                           now,
		outboxWorker:                  input.outboxWorker,
		overdueBroadcaster:            input.overdueBroadcaster,
		registry:                      registry,
		reminderNotifications:         input.reminderNotifications,
		retention:                     input.retention,
		rolloverDeadlineRunner:        input.rolloverDeadlineRunner,
		schoolRepo:                    directory,
		settings:                      settingsForSchedulerTest(input.settings),
		staffDocumentFileCleaner:      input.staffDocumentFileCleaner,
		studentChangeLogCleanup:       input.studentChangeLogCleanup,
		studentDocumentFileCleaner:    input.studentDocumentFileCleaner,
		studentLifecycleAudit:         input.studentLifecycleAudit,
		studentLifecycleRepo:          input.studentLifecycleRepo,
		studentStatusDayRepo:          input.studentStatusDayRepo,
		tasks:                         input.tasks,
		tenantRuntime:                 runtime,
		tenantRuntimeObserver:         input.tenantRuntimeObserver,
		timeTrackingCleanup:           input.timeTrackingCleanup,
		timetableBridge:               input.timetableBridge,
		timetableCleanup:              input.timetableCleanup,
		unitOfWorkObserver:            input.unitOfWorkObserver,
		workSessionCleanup:            input.workSessionCleanup,
		workerTracer:                  input.workerTracer,
	}
}
