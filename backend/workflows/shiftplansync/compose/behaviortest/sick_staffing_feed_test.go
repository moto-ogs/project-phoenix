package compose_test

import (
	"context"
	"encoding/json"
	"fmt"
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
	testpkg "github.com/moto-ogs/project-phoenix/test"
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
	db := testpkg.SetupTestDB(t)
	database, unit := testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db)
	now := func() time.Time { return time.Date(2030, 6, 10, 10, 0, 0, 0, calendar.Berlin) }
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	notices := owners.NewTimetableStaffNotices(owners.DeliveryNotifications{Notifier: notifier, Preferences: module.NotificationPreferences},
		owners.MustNewSchoolMembership(database), owners.MustNewUnobservedTimetable(database))
	absences, _, err := api.NewWorkforceTestModuleWithStaffingNotices(database, unit, notices.Staffing, now)
	require.NoError(t, err)
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
	_, err = db.ExecContext(context.Background(), `UPDATE activities.groups SET education_group_id = ? WHERE id = ?`, group.ID, template.ID)
	require.NoError(t, err)
	for day := 11; day <= 13; day++ {
		instance := testpkg.CreateTestActivityInstance(t, db, calendar.NewDate(2030, 6, day), room.ID, testpkg.ActivityInstanceOpts{Title: "Gruppenzeit", ActivityGroupID: &template.ID})
		testpkg.CreateTestInstanceStaff(t, db, instance.ID, sick, testpkg.InstanceStaffOpts{})
	}

	require.NoError(t, testpkg.WithTenantTx(t, context.Background(), db, testpkg.Tenant(t), func(ctx context.Context, _ bun.Tx) error {
		_, err := absences.SickReports.CreateAbsenceFor(ctx, sick, admin, &adminAccount, workforce.CreateAbsenceRequest{
			AbsenceType: "sick", DateStart: "2030-06-11", DateEnd: "2030-06-13",
		})
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
	assert.Equal(t, "Sie sind an 3 Tagen (11.–13.06.) als nicht da eingetragen.", own[0].Body)
	for _, entry := range append(teacher, own...) {
		assert.NotContains(t, strings.ToLower(entry.Title+entry.Body), "krank", "the reason never reaches the text")
	}
	assert.Empty(t, sickFeedEntries(t, router, adminAccount), "who entered the report gets nothing")
	assert.Empty(t, sickFeedEntries(t, router, otherLead), "another group's teacher gets nothing")

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
		applied, err := absences.SickReports.SyncAbsencePlan(ctx, absenceID, admin, &adminAccount)
		require.True(t, applied)
		return err
	}))
	synced := sickFeedEntries(t, router, vacationAccount)
	require.Len(t, synced, 1)
	assert.Equal(t, "Sie sind am Mo. 17.06. als nicht da eingetragen.", synced[0].Body)
	teacher = sickFeedEntries(t, router, lead)
	require.Len(t, teacher, 2)
	assert.Equal(t, "Ben Feed ist am Mo. 17.06. nicht da.", teacher[0].Body, "newest first")
	assert.Empty(t, sickFeedEntries(t, router, adminAccount))
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
