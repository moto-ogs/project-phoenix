package messaging_test

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"

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
	"github.com/stretchr/testify/require"
)

// The OGS sees under each of its messages what became of the e-mail that told
// the family (#7058): in a conversation the one mail, in a group thread the
// mails of all families counted by outcome. Real outbox, real outcome read.
func TestOGSMessagesShowWhatBecameOfTheirMail(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	repos := api.NewParentMessagingSuiteRepositories(database)
	people := api.NewPeopleRepositorySuiteFactory(database)
	accounts := api.NewAccountSuiteRepositories(database)
	directory := api.NewTestPersonDirectory(database, api.TestPersonDirectorySources{Persons: people.Person, Students: people.Student, Staff: people.Staff, AccountExists: api.AccountExists(accounts.Profile)})
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	delivery, err := api.NewDeliveryTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	identity := owners.NewPeopleIdentityAccess(database, nil)
	persons := owners.ParentMessagePeopleWithLeaders{ParentMessagePeople: owners.BindParentMessagePeople(directory), ParentMessageLeadership: owners.BindParentMessageLeadership(people.Staff, identity)}
	svc, groups, _, handling, mailStatus := compose.NewParentMessaging(compose.ParentMessagingConfig{
		ThreadRepo: repos.ParentMessageThread, MessageRepo: parentStore.NewParentMessageRepository(db), ReadRepo: repos.ParentMessageRead,
		Persons: persons, UserContext: owners.StaffStudentReads{}, Session: api.CommunicationSession{},
		Settings: settingsValues.NewParentMessagingValues(settings.Settings), Broadcaster: realtime.NewHub(slog.Default()), DB: db,
		Logger: slog.Default(), Observe: func(compose.Observation) {}, GroupAudience: owners.NewParentGroupAudience(database),
		Outbox: owners.OutboxEnqueuer{Outbox: delivery.EmailOutbox}, GuardianProfiles: owners.BindParentMessageGuardianProfiles(people.GuardianProfile),
		ParentsURL: "https://eltern.example", Mails: owners.ParentMessageMails{Outcomes: delivery.Runtime.EmailOutcomes},
	}, owners.CommunicationRequestRuntime{}, deliveryPolicy.ParentDeliveryPolicy{})
	_, staff := testpkg.CreateTestStaffWithAccount(t, db, "Mail", "Status")
	testpkg.EnsureAccountTenant(t, db, staff.ID, testpkg.Tenant(t))
	token := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(staff.ID), Sub: staff.Email, Roles: []string{"admin"}, Permissions: []string{"admin:*"}, TenantID: testpkg.Tenant(t)})
	router := testpkg.MountedQueryBudgetRouter("/api/messages", messaging.NewResource(svc, groups, handling, mailStatus).Router(api.ProtectedTenantRoutes))
	request := func(token, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(testpkg.Ctx(t))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		return testutil.ExecuteRequestForTest(t, router, req)
	}
	read := func(method, path, body string, out any) {
		t.Helper()
		rec := request(token, method, path, body)
		require.Contains(t, []int{200, 201}, rec.Code, rec.Body.String())
		envelope := struct{ Data any }{Data: out}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	}
	chain := testpkg.CreateTestParentGuardianChain(t, db)

	var thread messaging.ParentChatThreadDetailResponse
	read("POST", "/threads/open", fmt.Sprintf(`{"student_id":"%d","guardian_account_id":"%d"}`, chain.StudentID, chain.AccountID), &thread)
	read("POST", "/threads/"+thread.ThreadID.String(), `{"body":"Bitte Turnbeutel mitgeben"}`, &[]messaging.ParentChatMessageResponse{})
	read("GET", "/threads/"+thread.ThreadID.String(), "", &thread)
	require.Len(t, thread.Messages, 1)
	messageID := thread.Messages[0].ID
	var mails messaging.ThreadMailsResponse
	read("GET", "/threads/"+thread.ThreadID.String()+"/mails", "", &mails)
	require.Len(t, mails.Messages, 1)
	require.True(t, mails.AwaitingFeedback)
	require.Equal(t, "queued", mails.Messages[messageID], "the mail is queued with the message")

	_, err = db.NewRaw(`UPDATE platform.email_outbox SET status = 'sent', sent_at = now(), delivery_state = 'failed', delivery_state_at = now()
		WHERE related_entity_type = 'parent_message' AND related_entity_id = ?`, messageID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	read("GET", "/threads/"+thread.ThreadID.String()+"/mails", "", &mails)
	require.Len(t, mails.Messages, 1)
	require.False(t, mails.AwaitingFeedback)
	require.Equal(t, "undeliverable", mails.Messages[messageID])

	var group messaging.GroupThreadDetailResponse
	read("POST", "/group-threads", `{"target_type":"class","target_id":"1a","target_label":"Klasse 1a","title":"Ausflug","body":"Morgen Zoo"}`, &group)
	require.Len(t, group.Messages, 1)
	var groupMails messaging.GroupThreadMailsResponse
	read("GET", "/group-threads/"+group.Thread.ID.String()+"/mails", "", &groupMails)
	require.Len(t, groupMails.Messages, 1)
	require.True(t, groupMails.AwaitingFeedback)
	require.Equal(t, map[string]int{"queued": 1}, groupMails.Messages[group.Messages[0].ID], "one mail per family of the class")

	// The list shows the group thread with its families, the reach names
	// the child, and closing the thread ends it.
	var listed []messaging.StaffGroupThreadSummaryResponse
	read("GET", "/group-threads", "", &listed)
	require.Len(t, listed, 1)
	require.Equal(t, group.Thread.ID.String(), listed[0].ID.String())
	require.Equal(t, 1, listed[0].FamilyCount)
	var reachable messaging.ReachableStudentsResponse
	read("GET", "/reachable-students", "", &reachable)
	require.Contains(t, reachable.StudentIDs, ident.ID(chain.StudentID))
	var closed messaging.GroupThreadDetailResponse
	read("POST", "/group-threads/"+group.Thread.ID.String()+"/close", "", &closed)
	require.NotNil(t, closed.Thread.ClosedAt)

	// Another school's administrator reads neither status.
	foreignTenant, _ := testpkg.CreateTestTenant(t, db)
	_, foreign := testpkg.CreateTestStaffWithAccountForTenant(t, db, foreignTenant, "Foreign", "Mail")
	testpkg.EnsureAccountTenant(t, db, foreign.ID, foreignTenant)
	foreignToken := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(foreign.ID), Sub: foreign.Email, Roles: []string{"admin"}, Permissions: []string{"admin:*"}, TenantID: foreignTenant})
	for _, path := range []string{"/threads/" + thread.ThreadID.String() + "/mails", "/group-threads/" + group.Thread.ID.String() + "/mails"} {
		rec := request(foreignToken, "GET", path, "")
		require.Equal(t, 404, rec.Code, rec.Body.String())
	}
}
