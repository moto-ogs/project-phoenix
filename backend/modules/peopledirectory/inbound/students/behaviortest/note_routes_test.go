package students_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	studentsAPI "github.com/moto-ogs/project-phoenix/modules/peopledirectory/inbound/students"
)

// noteTeamReach names a fixed set of colleagues and records the pushes; the
// device notification is Delivery's, not this owner's.
type noteTeamReach struct {
	readers []int64
	pushed  []studentsAPI.StudentNoteSharedPush
}

func (r *noteTeamReach) NoteReaderAccountIDs(context.Context) ([]int64, error) { return r.readers, nil }

func (r *noteTeamReach) NotifyStudentNoteShared(_ context.Context, push studentsAPI.StudentNoteSharedPush) error {
	r.pushed = append(r.pushed, push)
	return nil
}

// productionPathExec drives the student router under its production mount.
func productionPathExec(t *testing.T, tc *testContext, method, path string, body any, claims sessiontoken.AppClaims, perms []string) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Mount("/api/students", tc.router())
	req := testutil.NewAuthenticatedRequest(t, method, "/api/students"+path, body)
	claims.Permissions = perms
	req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, claims))
	return testutil.ExecuteRequestForTest(t, router, req)
}

func dataOf[T any](t *testing.T, rr *httptest.ResponseRecorder, want int) T {
	t.Helper()
	require.Equal(t, want, rr.Code, rr.Body.String())
	var envelope struct {
		Data T `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
	return envelope.Data
}

type noteAnswer struct {
	ID        string `json:"id"`
	StudentID string `json:"student_id"`
	Body      string `json:"body"`
	Edited    bool   `json:"edited"`
}

type noticeAnswer struct {
	NoteID     string    `json:"note_id"`
	StudentID  string    `json:"student_id"`
	InformedAt time.Time `json:"informed_at"`
}

// A note is written, read, changed, shared with the team, read by a
// colleague and deleted through the routes (#6854).
func TestStudentNoteIsWrittenSharedReadAndDeletedThroughTheRoutes(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t)
	child := testpkg.CreateTestStudent(t, tc.db, "Notiz", "Kind", "N1")
	_, author := testpkg.CreateTestStaffWithAccount(t, tc.db, "Notiz", "Autorin")
	_, colleague := testpkg.CreateTestStaffWithAccount(t, tc.db, "Notiz", "Kollege")
	reach := &noteTeamReach{readers: []int64{author.ID, colleague.ID}}
	tc.resource.NoteTeamReach = reach
	asAuthor, asColleague := testutil.AdminTestClaims(int(author.ID)), testutil.AdminTestClaims(int(colleague.ID))
	perms := []string{"admin:*"}
	notes := fmt.Sprintf("/%d/notes", child.ID)

	created := dataOf[noteAnswer](t, productionPathExec(t, tc, http.MethodPost, notes, map[string]any{"kind": "permanent", "body": "Hat heute gut gegessen."}, asAuthor, perms), http.StatusCreated)
	assert.Equal(t, fmt.Sprint(child.ID), created.StudentID)
	assert.Equal(t, "Hat heute gut gegessen.", created.Body)

	listed := dataOf[[]noteAnswer](t, productionPathExec(t, tc, http.MethodGet, notes, nil, asAuthor, perms), http.StatusOK)
	require.Len(t, listed, 1)
	assert.Equal(t, created.ID, listed[0].ID)

	note := notes + "/" + created.ID
	updated := dataOf[noteAnswer](t, productionPathExec(t, tc, http.MethodPut, note, map[string]any{"kind": "permanent", "body": "Hat heute alles aufgegessen."}, asAuthor, perms), http.StatusOK)
	assert.Equal(t, "Hat heute alles aufgegessen.", updated.Body)

	informed := dataOf[struct {
		Informed int `json:"informed"`
	}](t, productionPathExec(t, tc, http.MethodPost, note+"/team-notices", nil, asAuthor, perms), http.StatusOK)
	assert.Equal(t, 1, informed.Informed, "the author is not told about their own note")
	require.Len(t, reach.pushed, 1)

	unread := dataOf[[]noticeAnswer](t, productionPathExec(t, tc, http.MethodGet, "/team-notices", nil, asColleague, perms), http.StatusOK)
	require.Len(t, unread, 1)
	assert.Equal(t, created.ID, unread[0].NoteID)
	left := dataOf[[]noticeAnswer](t, productionPathExec(t, tc, http.MethodPost, fmt.Sprintf("/%d/team-notices/read", child.ID),
		map[string]any{"notices": []map[string]any{{"note_id": unread[0].NoteID, "informed_at": unread[0].InformedAt}}}, asColleague, perms), http.StatusOK)
	assert.Empty(t, left, "the colleague read the shared note")

	deleted := dataOf[struct {
		ID string `json:"id"`
	}](t, productionPathExec(t, tc, http.MethodDelete, note, nil, asAuthor, perms), http.StatusOK)
	assert.Equal(t, created.ID, deleted.ID)
	assert.Empty(t, dataOf[[]noteAnswer](t, productionPathExec(t, tc, http.MethodGet, notes, nil, asAuthor, perms), http.StatusOK))
}

// The family protection of a child is switched on through the route and read
// back as stored.
func TestFamilyProtectionIsSwitchedAndReadThroughTheRoutes(t *testing.T) {
	t.Parallel()
	tc := setupStudentsRoute(t)
	child := testpkg.CreateTestStudent(t, tc.db, "Schutz", "Kind", "F1")
	_, admin := testpkg.CreateTestStaffWithAccount(t, tc.db, "Schutz", "Leitung")
	claims, perms := testutil.AdminTestClaims(int(admin.ID)), []string{"admin:*"}
	path := fmt.Sprintf("/%d/family-protection", child.ID)
	type protection struct {
		StudentID string `json:"student_id"`
		Enabled   bool   `json:"enabled"`
	}

	before := dataOf[protection](t, productionPathExec(t, tc, http.MethodGet, path, nil, claims, perms), http.StatusOK)
	assert.Equal(t, protection{StudentID: fmt.Sprint(child.ID)}, before)
	set := dataOf[protection](t, productionPathExec(t, tc, http.MethodPut, path, map[string]any{"enabled": true, "reason": "Gerichtliche Anordnung"}, claims, perms), http.StatusOK)
	assert.True(t, set.Enabled)
	after := dataOf[protection](t, productionPathExec(t, tc, http.MethodGet, path, nil, claims, perms), http.StatusOK)
	assert.True(t, after.Enabled, "the switch is stored")
}
