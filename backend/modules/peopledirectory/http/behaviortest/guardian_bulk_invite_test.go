package users_test

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	usersHTTP "github.com/moto-ogs/project-phoenix/modules/peopledirectory/http"
)

func bulkInviteDirectory() *fakeGuardianDirectory {
	return &fakeGuardianDirectory{students: map[int64]peopledirectory.Student{
		3: {ID: 3, Status: "active"},
		4: {ID: 4, Status: peopledirectory.StudentStatusAlumnus},
	}}
}

func TestBulkInviteIsGatedLikeTheSingleInvite(t *testing.T) {
	t.Parallel()
	h := newGuardianHarness(t, bulkInviteDirectory())
	body := map[string]any{"student_ids": []string{fmt.Sprint(3)}}

	assert.Equal(t, http.StatusForbidden, h.do(t, http.MethodPost, "/guardians/bulk-invite", body).Code, "users:create is required")

	h.permitted["users:create"] = true
	h.staff = false
	assert.Equal(t, http.StatusForbidden, h.do(t, http.MethodPost, "/guardians/bulk-invite", body).Code, "neither admin nor verified staff")

	h.actorID = 0
	assert.Equal(t, http.StatusUnauthorized, h.do(t, http.MethodPost, "/guardians/bulk-invite", body).Code)
	assert.Empty(t, h.bulkInvites, "a refused request never reaches the invitation flow")
}

func TestBulkInviteOnlyPassesActiveChildrenOfTheSchool(t *testing.T) {
	t.Parallel()
	h := newGuardianHarness(t, bulkInviteDirectory())
	h.permitted["users:create"] = true
	h.bulkResult = usersHTTP.GuardianBulkInviteResult{
		Invited: 2, SkippedOpen: 1, Notified: 3, AlreadyNotified: 1, WithoutVisibleCare: 2,
		Problems:    []usersHTTP.GuardianBulkInviteProblem{{GuardianProfileID: 9, GuardianName: "Katharina Brenner", Reason: "missing_email"}},
		Fingerprint: "preview-token",
	}

	recorder := h.do(t, http.MethodPost, "/guardians/bulk-invite", map[string]any{
		"student_ids": []string{fmt.Sprint(3), fmt.Sprint(4), fmt.Sprint(99)}, "resend_open": true, "dry_run": true, "notify_active": true,
	})

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Len(t, h.bulkInvites, 1)
	assert.Equal(t, usersHTTP.GuardianBulkInvite{StudentIDs: []int64{3}, ActorAccountID: 42, ResendOpen: true, DryRun: true, NotifyActive: true}, h.bulkInvites[0],
		"the graduated child and the unknown ID are dropped")
	assert.JSONEq(t, `{
		"dry_run": true, "invited": 2, "linked_existing_account": 0, "resent": 0,
		"skipped_active": 0, "skipped_open": 1, "skipped_restricted": 0,
		"notified": 3, "already_notified": 1, "without_visible_care": 2,
		"problems": [{"guardian_profile_id": "9", "guardian_name": "Katharina Brenner", "student_names": [], "reason": "missing_email"}],
		"fingerprint": "preview-token"
	}`, string(decode(t, recorder).Data))
}

// The run hands the preview's fingerprint to the owner, which compares it
// (ADR 0311).
func TestBulkInvitePassesThePreviewFingerprintToTheRun(t *testing.T) {
	t.Parallel()
	h := newGuardianHarness(t, bulkInviteDirectory())
	h.permitted["users:create"] = true

	recorder := h.do(t, http.MethodPost, "/guardians/bulk-invite", map[string]any{
		"student_ids": []string{fmt.Sprint(3)}, "expected_fingerprint": "preview-token",
	})

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Len(t, h.bulkInvites, 1)
	assert.Equal(t, "preview-token", h.bulkInvites[0].ExpectedFingerprint)
}

func TestBulkInviteRejectsSelectionsWithoutAnActiveChild(t *testing.T) {
	t.Parallel()
	h := newGuardianHarness(t, bulkInviteDirectory())
	h.permitted["users:create"] = true

	assert.Equal(t, http.StatusBadRequest, h.do(t, http.MethodPost, "/guardians/bulk-invite", map[string]any{"student_ids": []string{}}).Code)
	assert.Equal(t, http.StatusNotFound, h.do(t, http.MethodPost, "/guardians/bulk-invite", map[string]any{"student_ids": []string{fmt.Sprint(4), fmt.Sprint(99)}}).Code)
	assert.Empty(t, h.bulkInvites)
}

func TestBulkInviteRejectsOversizedSelectionsBeforeReadingStudents(t *testing.T) {
	t.Parallel()
	directory := bulkInviteDirectory()
	h := newGuardianHarness(t, directory)
	h.permitted["users:create"] = true

	studentIDs := make([]int64, 2001)
	assert.Equal(t, http.StatusBadRequest, h.do(t, http.MethodPost, "/guardians/bulk-invite", map[string]any{"student_ids": testpkg.IDsOf[testpkg.ID](studentIDs)}).Code)
	assert.Zero(t, directory.studentLookups)
	assert.Empty(t, h.bulkInvites)
}

func TestBulkInviteFailureUsesTheInviteClassification(t *testing.T) {
	t.Parallel()
	h := newGuardianHarness(t, bulkInviteDirectory())
	h.permitted["users:create"] = true
	h.bulkErr = errors.New("boom")

	assert.Equal(t, http.StatusForbidden, h.do(t, http.MethodPost, "/guardians/bulk-invite", map[string]any{"student_ids": []string{fmt.Sprint(3)}}).Code)
}
