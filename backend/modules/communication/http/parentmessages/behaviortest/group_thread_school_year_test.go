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

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	compose "github.com/moto-ogs/project-phoenix/modules/communication/composition"
	messaging "github.com/moto-ogs/project-phoenix/modules/communication/http/parentmessages"
	parentStore "github.com/moto-ogs/project-phoenix/modules/communication/parentstore"
	deliveryPolicy "github.com/moto-ogs/project-phoenix/modules/delivery/devices"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	settingsValues "github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The class messages to parents follow the school-year change like the class
// teachers and the class lists (#8214): the thread of the 3a becomes the
// thread of the 4a with the same families, the next 3a does not get it, the
// thread of a class that leaves is closed with its reason, a draft
// announcement to the 3a goes to the 4a, and the revert puts all of it back.
// A class thread of another school is never touched.
func TestClassMessagesToParentsFollowTheSchoolYearChange(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	module, err := rootAPI.NewGradeTransitionTestModule(database, nil)
	require.NoError(t, err)
	ctx := testpkg.Ctx(t)
	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.NewRaw(query, args...).Exec(ctx)
		require.NoError(t, err)
	}

	repos := rootAPI.NewParentMessagingSuiteRepositories(database)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	svc, groups, _, handling, mailStatus := compose.NewParentMessaging(compose.ParentMessagingConfig{
		ThreadRepo: repos.ParentMessageThread, MessageRepo: parentStore.NewParentMessageRepository(db), ReadRepo: repos.ParentMessageRead,
		UserContext: owners.StaffStudentReads{}, Session: rootAPI.CommunicationSession{},
		Settings: settingsValues.NewParentMessagingValues(settings.Settings), Broadcaster: realtime.NewHub(slog.Default()), DB: db,
		Logger: slog.Default(), Observe: func(compose.Observation) {}, GroupAudience: owners.NewParentGroupAudience(database),
		GroupTargetNames: owners.NewParentGroupTargetNamesForTests(t, database),
	}, owners.CommunicationRequestRuntime{}, deliveryPolicy.ParentDeliveryPolicy{})
	messages := testpkg.MountedQueryBudgetRouter("/api/messages", messaging.NewResource(svc, groups, handling, mailStatus).Router(rootAPI.ProtectedTenantRoutes))
	transitions := module.Router()

	_, staff := testpkg.CreateTestStaffWithAccount(t, db, "Klasse", "Folgt")
	testpkg.EnsureAccountTenant(t, db, staff.ID, testpkg.Tenant(t))
	token := testutil.MintTestJWT(t, sessiontoken.AppClaims{
		ID: int(staff.ID), Sub: staff.Email, Roles: []string{"admin"}, TenantID: testpkg.Tenant(t),
		Permissions: []string{"admin:*", permissions.GradeTransitionsRead, permissions.GradeTransitionsApply},
	})
	call := func(router chi.Router, method, path, body string, wantStatus int, out any) {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(ctx)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := testutil.ExecuteRequestForTest(t, router, req)
		require.Equal(t, wantStatus, rec.Code, rec.Body.String())
		if out != nil {
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &struct{ Data any }{Data: out}))
		}
	}
	thread := func(id string) messaging.GroupThreadDetailResponse {
		t.Helper()
		var detail messaging.GroupThreadDetailResponse
		call(messages, "GET", "/group-threads/"+id, "", http.StatusOK, &detail)
		return detail
	}
	inClass := func(class string) testpkg.ParentChain {
		t.Helper()
		chain := testpkg.CreateTestParentGuardianChain(t, db)
		exec(`UPDATE users.student_school_memberships SET school_class = ? WHERE student_profile_id = ?`, class, chain.StudentID)
		return chain
	}

	third, fourth := inClass("3a"), inClass("4a")
	open := func(class string) string {
		t.Helper()
		var detail messaging.GroupThreadDetailResponse
		call(messages, "POST", "/group-threads", fmt.Sprintf(`{"target_type":"class","target_id":%q,"target_label":"Klasse %s","title":"Elternabend","body":"Am Montag"}`, class, class), http.StatusCreated, &detail)
		return detail.Thread.ID.String()
	}
	thirdThread, fourthThread := open("3a"), open("4a")

	var draftID int64
	require.NoError(t, db.NewRaw(`INSERT INTO users.parent_announcements (tenant_id, title, body, created_by) VALUES (?, 'Ausflug', 'Zoo', ?) RETURNING id`,
		testpkg.Tenant(t), staff.ID).Scan(ctx, &draftID))
	exec(`INSERT INTO users.parent_announcement_targets (tenant_id, announcement_id, target_type, target_ref_text) VALUES (?, ?, 'class', '3a'), (?, ?, 'class', '4a')`,
		testpkg.Tenant(t), draftID, testpkg.Tenant(t), draftID)
	draftClasses := func() []string {
		t.Helper()
		var classes []string
		require.NoError(t, db.NewRaw(`SELECT target_ref_text FROM users.parent_announcement_targets WHERE announcement_id = ? ORDER BY id`, draftID).Scan(ctx, &classes))
		return classes
	}

	foreignTenant, _ := testpkg.CreateTestTenant(t, db)
	var foreignThread int64
	require.NoError(t, db.NewRaw(`INSERT INTO users.parent_group_threads (tenant_id, target_type, target_ref_text, target_label, title) VALUES (?, 'class', '3a', 'Klasse 3a', 'Fremd') RETURNING id`,
		foreignTenant).Scan(ctx, &foreignThread))

	transition := testpkg.CreateTestGradeTransition(t, db, "2026-2027", staff.ID)
	testpkg.CreateTestGradeTransitionMapping(t, db, transition.ID, "3a", testpkg.StrPtr("4a"))
	testpkg.CreateTestGradeTransitionMapping(t, db, transition.ID, "4a", nil)

	// The preview names every class message the apply moves or closes.
	var preview struct {
		Fingerprint   string `json:"fingerprint"`
		ParentTargets []struct {
			Kind      string   `json:"kind"`
			ID        ident.ID `json:"id"`
			FromClass string   `json:"from_class"`
			ToClass   *string  `json:"to_class"`
		} `json:"parent_targets"`
	}
	call(transitions, "GET", fmt.Sprintf("/%d/preview", transition.ID), "", http.StatusOK, &preview)
	moves := make(map[string]string, len(preview.ParentTargets))
	for _, target := range preview.ParentTargets {
		to := "geschlossen"
		if target.ToClass != nil {
			to = *target.ToClass
		}
		moves[target.Kind+" "+target.ID.String()+" "+target.FromClass] = to
	}
	require.Equal(t, map[string]string{
		"group_thread " + thirdThread + " 3a":            "4a",
		"group_thread " + fourthThread + " 4a":           "geschlossen",
		fmt.Sprintf("announcement_draft %d 3a", draftID): "4a",
		fmt.Sprintf("announcement_draft %d 4a", draftID): "geschlossen",
	}, moves)

	apply, err := json.Marshal(map[string]string{"expected_fingerprint": preview.Fingerprint})
	require.NoError(t, err)
	call(transitions, "POST", fmt.Sprintf("/%d/apply", transition.ID), string(apply), http.StatusOK, nil)

	moved := thread(thirdThread)
	require.Equal(t, "Klasse 4a", moved.Thread.TargetLabel, "the thread of the 3a is now the thread of the 4a")
	require.Nil(t, moved.Thread.ClosedAt)
	require.Equal(t, &messaging.GroupThreadClassMoveResponse{FromClass: "3a", ToClass: testpkg.StrPtr("4a")}, moved.Thread.ClassMove)
	left := thread(fourthThread)
	require.NotNil(t, left.Thread.ClosedAt, "the thread of a class that leaves is closed")
	require.Equal(t, &messaging.GroupThreadClassMoveResponse{FromClass: "4a"}, left.Thread.ClassMove, "the closed thread names why")
	call(messages, "POST", "/group-threads/"+fourthThread+"/messages", `{"body":"Noch da?"}`, http.StatusConflict, nil)
	require.Equal(t, []string{"4a"}, draftClasses(), "the draft to the 3a goes to the 4a and loses the leaving 4a")

	// The next 3a does not get the thread; its families stay with the children.
	newcomer := inClass("3a")
	var sent messaging.GroupThreadDetailResponse
	call(messages, "POST", "/group-threads/"+thirdThread+"/messages", `{"body":"Neue Klasse, gleiche Familien"}`, http.StatusCreated, &sent)
	reached := make([]string, 0, len(sent.Children))
	for _, child := range sent.Children {
		reached = append(reached, child.StudentID.String())
	}
	require.Contains(t, reached, fmt.Sprint(third.StudentID))
	require.NotContains(t, reached, fmt.Sprint(newcomer.StudentID), "the new 3a never reads the thread of the old 3a")
	require.NotContains(t, reached, fmt.Sprint(fourth.StudentID))

	var foreign struct {
		Class string          `bun:"target_ref_text"`
		Moves json.RawMessage `bun:"class_moves"`
	}
	require.NoError(t, db.NewRaw(`SELECT target_ref_text, class_moves FROM users.parent_group_threads WHERE id = ?`, foreignThread).Scan(ctx, &foreign))
	require.Equal(t, "3a", foreign.Class, "another school's class thread stays where it is")
	require.JSONEq(t, `[]`, string(foreign.Moves))

	// The revert puts every thread and draft target back.
	call(transitions, "POST", fmt.Sprintf("/%d/revert", transition.ID), "", http.StatusOK, nil)
	back := thread(thirdThread)
	require.Equal(t, "Klasse 3a", back.Thread.TargetLabel)
	require.Nil(t, back.Thread.ClassMove)
	reopened := thread(fourthThread)
	require.Nil(t, reopened.Thread.ClosedAt, "the revert opens the thread it closed")
	require.Nil(t, reopened.Thread.ClassMove)
	require.Equal(t, []string{"3a", "4a"}, draftClasses())
}
