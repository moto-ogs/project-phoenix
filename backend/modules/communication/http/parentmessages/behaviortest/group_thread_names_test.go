package messaging_test

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	compose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	messaging "github.com/moto-ogs/project-phoenix/modules/communication/http/parentmessages"
	parentStore "github.com/moto-ogs/project-phoenix/modules/communication/parentstore"
	deliveryPolicy "github.com/moto-ogs/project-phoenix/modules/delivery/devices"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	settingsValues "github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A group thread is a link to its target (#8207): renaming the group or AG
// renames the thread in the OGS list and detail at once, a class thread names
// its class, and a target that is gone or lies in another school keeps the
// name the thread was opened with.
func TestGroupThreadShowsTheCurrentNameOfItsTarget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	repos := api.NewParentMessagingSuiteRepositories(database)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	svc, groups, _, handling, mailStatus := compose.NewParentMessaging(compose.ParentMessagingConfig{
		ThreadRepo: repos.ParentMessageThread, MessageRepo: parentStore.NewParentMessageRepository(db), ReadRepo: repos.ParentMessageRead,
		UserContext: owners.StaffStudentReads{}, Session: api.CommunicationSession{},
		Settings: settingsValues.NewParentMessagingValues(settings.Settings), Broadcaster: realtime.NewHub(slog.Default()), DB: db,
		Logger: slog.Default(), Observe: func(compose.Observation) {}, GroupAudience: owners.NewParentGroupAudience(database),
		GroupTargetNames: owners.NewParentGroupTargetNamesForTests(t, database),
	}, owners.CommunicationRequestRuntime{}, deliveryPolicy.ParentDeliveryPolicy{})
	_, staff := testpkg.CreateTestStaffWithAccount(t, db, "Name", "Folgt")
	testpkg.EnsureAccountTenant(t, db, staff.ID, testpkg.Tenant(t))
	token := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(staff.ID), Sub: staff.Email, Roles: []string{"admin"}, Permissions: []string{"admin:*"}, TenantID: testpkg.Tenant(t)})
	router := testpkg.MountedQueryBudgetRouter("/api/messages", messaging.NewResource(svc, groups, handling, mailStatus).Router(api.ProtectedTenantRoutes))
	read := func(method, path, body string, out any) {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(testpkg.Ctx(t))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := testutil.ExecuteRequestForTest(t, router, req)
		require.Contains(t, []int{200, 201}, rec.Code, rec.Body.String())
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &struct{ Data any }{Data: out}))
	}
	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.NewRaw(query, args...).Exec(testpkg.Ctx(t))
		require.NoError(t, err)
	}

	chain := testpkg.CreateTestParentGuardianChain(t, db)
	group := testpkg.CreateTestEducationGroup(t, db, "Füchse")
	ag := testpkg.CreateTestActivityGroup(t, db, "Fußball")
	exec(`UPDATE users.student_school_memberships SET group_id = ? WHERE student_profile_id = ?`, group.ID, chain.StudentID)
	exec(`INSERT INTO activities.student_enrollments (tenant_id, activity_group_id, student_id, valid_from) VALUES (?, ?, ?, '2020-01-01')`, chain.TenantID, ag.ID, chain.StudentID)

	open := func(targetType, targetID, label string) messaging.GroupThreadDetailResponse {
		t.Helper()
		var detail messaging.GroupThreadDetailResponse
		read("POST", "/group-threads", fmt.Sprintf(`{"target_type":%q,"target_id":%q,"target_label":%q,"title":"Ausflug","body":"Morgen Zoo"}`, targetType, targetID, label), &detail)
		return detail
	}
	groupThread := open("group", fmt.Sprint(group.ID), "Gruppe "+group.Name)
	agThread := open("activity_group", fmt.Sprint(ag.ID), "AG "+ag.Name)
	// The class thread was opened with a label that does not match its class.
	classThread := open("class", "1a", "Klasse Klasse 1a")
	require.Equal(t, "Klasse 1a", classThread.Thread.TargetLabel, "a class thread names the class it writes to")

	exec(`UPDATE education.groups SET name = 'Eulen' WHERE id = ?`, group.ID)
	exec(`UPDATE activities.groups SET name = 'Schach' WHERE id = ?`, ag.ID)

	labels := func() map[string]string {
		t.Helper()
		var listed []messaging.StaffGroupThreadSummaryResponse
		read("GET", "/group-threads", "", &listed)
		out := make(map[string]string, len(listed))
		for _, row := range listed {
			out[row.ID.String()] = row.TargetLabel
			require.Equal(t, row.TargetLabel, row.Readers.TargetLabel, "the reach line names the same target")
		}
		return out
	}
	require.Equal(t, map[string]string{
		groupThread.Thread.ID.String(): "Gruppe Eulen",
		agThread.Thread.ID.String():    "AG Schach",
		classThread.Thread.ID.String(): "Klasse 1a",
	}, labels(), "the list shows the new names at once")
	var detail messaging.GroupThreadDetailResponse
	read("GET", "/group-threads/"+groupThread.Thread.ID.String(), "", &detail)
	require.Equal(t, "Gruppe Eulen", detail.Thread.TargetLabel, "the detail shows the new name")

	// A target in another school never lends its name: the thread keeps the
	// label it was opened with, as it does for a group that is gone.
	foreignTenant, _ := testpkg.CreateTestTenant(t, db)
	foreign := testpkg.CreateTestEducationGroupForTenant(t, db, foreignTenant, "Fremd")
	exec(`UPDATE users.parent_group_threads SET target_ref_id = ? WHERE id = ?`, foreign.ID, groupThread.Thread.ID.Int64())
	exec(`UPDATE users.parent_group_threads SET target_ref_id = ? WHERE id = ?`, ag.ID+1_000_000_000, agThread.Thread.ID.Int64())
	require.Equal(t, map[string]string{
		groupThread.Thread.ID.String(): "Gruppe " + group.Name,
		agThread.Thread.ID.String():    "AG " + ag.Name,
		classThread.Thread.ID.String(): "Klasse 1a",
	}, labels(), "without a target of its school the thread keeps its stored name")
}
