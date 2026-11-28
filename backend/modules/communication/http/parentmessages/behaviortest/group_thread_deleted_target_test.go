package messaging_test

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	compose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	messaging "github.com/moto-ogs/project-phoenix/modules/communication/http/parentmessages"
	parentStore "github.com/moto-ogs/project-phoenix/modules/communication/parentstore"
	deliveryPolicy "github.com/moto-ogs/project-phoenix/modules/delivery/devices"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	schoolstructurehttp "github.com/moto-ogs/project-phoenix/modules/schoolstructure/http"
	settingsValues "github.com/moto-ogs/project-phoenix/modules/settings"
	activitiesAPI "github.com/moto-ogs/project-phoenix/modules/timetable/http/activities"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A deleted group or AG closes its group threads (#8213). The source is
// deleted through its own owner's route, School Structure for the group and
// the Timetable for the AG; the thread read through Communication's route
// follows at once: it stays readable, names the reason and refuses a new
// message. A class thread and a thread of a group that still exists stay
// open.
func TestDeletingTheGroupClosesItsGroupThreads(t *testing.T) {
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

	structure, _, people, _, err := api.NewGroupsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	activityModule, activities, users, caller, err := api.NewActivitiesTestModule(database)
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Mount("/api/messages", messaging.NewResource(svc, groups, handling, mailStatus).Router(api.ProtectedTenantRoutes))
	router.Mount("/api/groups", schoolstructurehttp.NewResource(structure.Education, people.People, transactionFailures.IsConstraintViolation).Router(api.ProtectedTenantRoutes))
	router.Mount("/api/activities", activitiesAPI.NewResource(activities, activityModule.Timetable, api.NewTimetableSupervisorDirectory(users), caller, api.TimetableHTTPTransactions).Router(api.ProtectedTenantRoutes))

	_, staff := testpkg.CreateTestStaffWithAccount(t, db, "Gruppe", "Geloescht")
	testpkg.EnsureAccountTenant(t, db, staff.ID, testpkg.Tenant(t))
	token := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(staff.ID), Sub: staff.Email, Roles: []string{"admin"}, Permissions: []string{"admin:*"}, TenantID: testpkg.Tenant(t)})
	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(testpkg.Ctx(t))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		return testutil.ExecuteRequestForTest(t, router, req)
	}
	read := func(method, path, body string, out any) {
		t.Helper()
		rec := call(method, path, body)
		require.Contains(t, []int{http.StatusOK, http.StatusCreated}, rec.Code, rec.Body.String())
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &struct{ Data any }{Data: out}))
	}
	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.NewRaw(query, args...).Exec(testpkg.Ctx(t))
		require.NoError(t, err)
	}

	chain := testpkg.CreateTestParentGuardianChain(t, db)
	deleted := testpkg.CreateTestEducationGroup(t, db, "Füchse")
	kept := testpkg.CreateTestEducationGroup(t, db, "Eulen")
	ag := testpkg.CreateTestActivityGroup(t, db, "Fußball")
	exec(`UPDATE users.student_school_memberships SET group_id = ? WHERE student_profile_id = ?`, deleted.ID, chain.StudentID)
	exec(`INSERT INTO activities.student_enrollments (tenant_id, activity_group_id, student_id, valid_from) VALUES (?, ?, ?, '2020-01-01')`, chain.TenantID, ag.ID, chain.StudentID)

	open := func(targetType, targetID, label string) string {
		t.Helper()
		var detail messaging.GroupThreadDetailResponse
		read("POST", "/api/messages/group-threads", fmt.Sprintf(`{"target_type":%q,"target_id":%q,"target_label":%q,"title":"Ausflug","body":"Morgen Zoo"}`, targetType, targetID, label), &detail)
		require.Empty(t, detail.Thread.ClosedReason, "a new thread is open")
		return detail.Thread.ID.String()
	}
	groupThread := open("group", fmt.Sprint(deleted.ID), "Gruppe Füchse")
	agThread := open("activity_group", fmt.Sprint(ag.ID), "AG Fußball")
	classThread := open("class", "1a", "Klasse 1a")
	// The group that stays reaches the child as well.
	exec(`UPDATE users.student_school_memberships SET group_id = ? WHERE student_profile_id = ?`, kept.ID, chain.StudentID)
	keptThread := open("group", fmt.Sprint(kept.ID), "Gruppe Eulen")

	// The group is deleted once its children have moved; the thread does not
	// block it. The AG is deleted with its enrolments.
	rec := call("DELETE", fmt.Sprintf("/api/groups/%d", deleted.ID), "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = call("DELETE", fmt.Sprintf("/api/activities/%d", ag.ID), "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var listed []messaging.StaffGroupThreadSummaryResponse
	read("GET", "/api/messages/group-threads", "", &listed)
	reasons, labels := map[string]string{}, map[string]string{}
	for _, row := range listed {
		reasons[row.ID.String()], labels[row.ID.String()] = row.ClosedReason, row.TargetLabel
		require.Nil(t, row.ClosedAt, "nobody closed the thread by hand")
	}
	require.Equal(t, map[string]string{
		groupThread: "group_deleted", agThread: "group_deleted", classThread: "", keptThread: "",
	}, reasons, "the threads of the deleted group and AG read closed")
	require.Equal(t, "Gruppe Füchse", labels[groupThread], "a deleted group keeps the name the thread knew")
	require.Equal(t, "AG Fußball", labels[agThread], "a deleted AG keeps the name the thread knew")

	for _, id := range []string{groupThread, agThread} {
		var detail messaging.GroupThreadDetailResponse
		read("GET", "/api/messages/group-threads/"+id, "", &detail)
		require.Equal(t, "group_deleted", detail.Thread.ClosedReason, "the detail names the reason")
		require.Len(t, detail.Messages, 1, "the thread stays readable")

		rec := call("POST", "/api/messages/group-threads/"+id+"/messages", `{"body":"Noch eine Frage"}`)
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		require.Contains(t, rec.Body.String(), common.CodeCommunicationGroupThreadClosed, "sending is refused as for a closed thread")
	}
	var detail messaging.GroupThreadDetailResponse
	read("POST", "/api/messages/group-threads/"+keptThread+"/messages", `{"body":"Gruppe Eulen bleibt"}`, &detail)
	require.Len(t, detail.Messages, 2, "a thread of a group that exists still takes messages")
}
