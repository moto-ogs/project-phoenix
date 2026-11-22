package compose_test

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/moto-ogs/project-phoenix/workflows/shiftplansync"
	"github.com/moto-ogs/project-phoenix/workflows/shiftplansync/compose"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// A Krankmeldung (#7136) tells the sick person and the teachers of the
// affected group through the real absence write: one entry for the whole
// absence, never its reason, nothing for whoever entered it and nothing for a
// colleague outside the group.
func TestSickReportTellsThePersonAndTheGroupOnce(t *testing.T) {
	t.Parallel()
	now := func() time.Time { return time.Date(2030, 6, 10, 10, 0, 0, 0, calendar.Berlin) }
	env := newPlanSyncEnv(t, nil, now)
	db := testpkg.SetupTestDB(t) // the package pool env composed over
	absences := newStaffingNoticeSickReports(t, env, now)
	module := absences.module
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "notifications.active_window_end", `"06:00"`)

	group := testpkg.CreateTestEducationGroup(t, db, "Regenbogen")
	other := testpkg.CreateTestEducationGroup(t, db, "Wolke")
	sick, sickAccount := sickFeedPerson(t, db, "Anna")
	admin, adminAccount := sickFeedPerson(t, db, "Leitung")
	lead := sickFeedTeacher(t, db, "Lehrkraft", group.ID)
	otherLead := sickFeedTeacher(t, db, "Andere", other.ID)
	room := testpkg.CreateTestRoom(t, db, fmt.Sprintf("Feed-Room-%d", time.Now().UnixNano()))
	template := testpkg.CreateTestActivityGroup(t, db, "Gruppenzeit")
	_, err := db.ExecContext(context.Background(), `UPDATE activities.groups SET education_group_id = ? WHERE id = ?`, group.ID, template.ID)
	require.NoError(t, err)
	for day := 11; day <= 13; day++ {
		instance := testpkg.CreateTestActivityInstance(t, db, calendar.NewDate(2030, 6, day), room.ID, testpkg.ActivityInstanceOpts{Title: "Gruppenzeit", ActivityGroupID: &template.ID})
		testpkg.CreateTestInstanceStaff(t, db, instance.ID, sick, testpkg.InstanceStaffOpts{})
	}

	var sickReportID int64
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, testpkg.Tenant(t), func(ctx context.Context, _ bun.Tx) error {
		created, err := absences.reports.CreateAbsenceFor(ctx, sick, admin, &adminAccount, workforce.CreateAbsenceRequest{
			AbsenceType: "sick", DateStart: "2030-06-11", DateEnd: "2030-06-13",
		})
		if created != nil {
			sickReportID = created.ID.Int64()
		}
		return err
	}))

	router := module.NotificationPreferenceRouterForTests()
	teacher := sickFeedEntries(t, router, lead)
	require.Len(t, teacher, 1, "one entry for the whole absence")
	assert.Equal(t, "group_staffing_changed", teacher[0].Type)
	assert.Equal(t, "Anna Feed ist an 3 Tagen (11.–13.06.) nicht da.", teacher[0].Body)
	assert.True(t, strings.HasPrefix(teacher[0].DeepLink, "/vertretung?d=2030-06-11&block="), teacher[0].DeepLink)
	own := sickFeedEntries(t, router, sickAccount)
	require.Len(t, own, 1)
	assert.Equal(t, "Du bist an 3 Tagen (11.–13.06.) als nicht da eingetragen.", own[0].Body)
	for _, entry := range append(teacher, own...) {
		assert.NotContains(t, strings.ToLower(entry.Title+entry.Body), "krank", "the reason never reaches the text")
	}
	assert.Empty(t, sickFeedEntries(t, router, adminAccount), "who entered the report gets nothing")
	assert.Empty(t, sickFeedEntries(t, router, otherLead), "another group's teacher gets nothing")

	// Withdrawing the report tells the same people that the person is there
	// again, without the reason either.
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, testpkg.Tenant(t), func(ctx context.Context, _ bun.Tx) error {
		return absences.reports.DeleteAbsenceFor(ctx, sick, admin, &adminAccount, sickReportID)
	}))
	teacher = sickFeedEntries(t, router, lead)
	require.Len(t, teacher, 2)
	assert.Equal(t, "Anna Feed ist an 3 Tagen (11.–13.06.) doch da.", teacher[0].Body, "newest first")
	assert.Equal(t, "Du bist an 3 Tagen (11.–13.06.) wieder eingeplant.", sickFeedEntries(t, router, sickAccount)[0].Body)
	assert.Empty(t, sickFeedEntries(t, router, adminAccount))

	// Dienstplan-Abgleich (#7021): an absence stored before every type
	// cascaded takes its plan effect on the actor's behalf and tells the
	// same people.
	vacation, vacationAccount := sickFeedPerson(t, db, "Ben")
	instance := testpkg.CreateTestActivityInstance(t, db, calendar.NewDate(2030, 6, 17), room.ID, testpkg.ActivityInstanceOpts{Title: "Gruppenzeit", ActivityGroupID: &template.ID})
	testpkg.CreateTestInstanceStaff(t, db, instance.ID, vacation, testpkg.InstanceStaffOpts{})
	var absenceID int64
	require.NoError(t, db.NewRaw(`INSERT INTO active.staff_absences (tenant_id, staff_id, absence_type, date_start, date_end, status, created_by, working_days, requested_at)
		VALUES (?, ?, ?, '2030-06-17', '2030-06-17', ?, ?, 1, NOW()) RETURNING id`,
		testpkg.Tenant(t), vacation, workforce.AbsenceTypeVacation, workforce.AbsenceStatusApproved, vacation).Scan(context.Background(), &absenceID))
	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, testpkg.Tenant(t), func(ctx context.Context, _ bun.Tx) error {
		applied, err := absences.reports.SyncAbsencePlan(ctx, absenceID, admin, &adminAccount)
		require.True(t, applied)
		return err
	}))
	synced := sickFeedEntries(t, router, vacationAccount)
	require.Len(t, synced, 1)
	assert.Equal(t, "Du bist am Mo. 17.06. als nicht da eingetragen.", synced[0].Body)
	teacher = sickFeedEntries(t, router, lead)
	require.Len(t, teacher, 3)
	assert.Equal(t, "Ben Feed ist am Mo. 17.06. nicht da.", teacher[0].Body, "newest first")
	assert.Empty(t, sickFeedEntries(t, router, otherLead), "another group's teacher gets nothing")
	assert.Empty(t, sickFeedEntries(t, router, adminAccount))
}

// staffingNoticeSickReports are the sick-report writes over a cascade whose
// deviation writes tell the people concerned (#7136), with the Delivery
// module whose feed the test reads.
type staffingNoticeSickReports struct {
	reports *shiftplansync.SickReports
	module  api.DeliveryTestModule
}

// newStaffingNoticeSickReports binds the plan-sync environment's cascade the
// way the composition root does, with the staffing notices wired into the
// Timetable deviation writes it marks blocks through.
func newStaffingNoticeSickReports(t *testing.T, env planSyncEnv, now func() time.Time) staffingNoticeSickReports {
	t.Helper()
	database, unit := testpkg.NewDatabase(t, env.db), testpkg.TenantRuntime(t, env.db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	membership := owners.MustNewSchoolMembership(database)
	notices := owners.NewTimetableStaffNotices(owners.DeliveryNotifications{Notifier: notifier, Preferences: module.NotificationPreferences},
		membership, owners.MustNewUnobservedTimetable(database), owners.MustNewWorkforce(database))
	members := owners.MustNewMembershipTestRepositories(database)
	hub := testpkg.NewRecordingBroadcaster()
	deps, err := owners.TimetableStaffDeviationDependencies(env.repos.OwnerRows(), owners.NewTimetableStaff(members.Staff),
		api.NewPresenceSuiteRepositories(database).GroupSupervisor, env.timetable.Instance.DeviationLifecycle(), hub, slog.Default(), now)
	require.NoError(t, err)
	deps.StaffingNotices = notices.Staffing
	deviations, err := api.NewTimetableTestDeviations(database, deps)
	require.NoError(t, err)
	cascade, err := compose.NewSickCascade(compose.SickCascadeDependencies{
		Planning: env.Planning, Workforce: env.shifts, LockStaffShifts: env.Lock, LockStaff: owners.SickReportStaffLock(membership),
		Deviations: deviations, TimetableData: api.NewSickCascadeTimetableRows(env.repos.OwnerRows(), database),
		InstanceStaff: env.repos.InstanceStaffReads(), Broadcaster: hub, Logger: slog.Default(), Today: calendar.CalendarDateClock(now),
	})
	require.NoError(t, err)
	workforceModule, _, err := api.NewWorkforceTestModule(database, unit, now)
	require.NoError(t, err)
	reports, err := shiftplansync.NewSickReports(workforceModule.TimeTracking.StaffAbsences, cascade, tenant.NewTransactionRunner().RunInTx)
	require.NoError(t, err)
	return staffingNoticeSickReports{reports: reports, module: module}
}

func sickFeedPerson(t *testing.T, db *bun.DB, name string) (int64, int64) {
	t.Helper()
	staff, account := testpkg.CreateTestStaffWithAccount(t, db, name, "Feed")
	testpkg.MapAccountToTenant(t, db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, db, account.ID, testpkg.Tenant(t))
	return staff.ID, account.ID
}

func sickFeedTeacher(t *testing.T, db *bun.DB, name string, groupID int64) int64 {
	t.Helper()
	teacher, account := testpkg.CreateTestTeacherWithAccount(t, db, name, "Feed")
	testpkg.MapAccountToTenant(t, db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, db, account.ID, testpkg.Tenant(t))
	testpkg.CreateTestGroupTeacher(t, db, groupID, teacher.ID)
	return account.ID
}

type sickFeedEntry struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	DeepLink string `json:"deep_link"`
}

func sickFeedEntries(t *testing.T, router chi.Router, accountID int64) []sickFeedEntry {
	t.Helper()
	claims := testutil.TeacherTestClaims(int(accountID))
	claims.TenantID = testpkg.Tenant(t)
	request := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/api/notifications/feed", nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	response := testutil.ExecuteRequestForTest(t, router, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var feed struct {
		Data struct {
			Entries []sickFeedEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &feed))
	return feed.Data.Entries
}
