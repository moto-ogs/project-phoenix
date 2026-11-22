package studentpresencehttp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// bytesReader is a local convenience wrapper — the existing helpers pass
// nil for GET bodies, but our POST cases need a real reader.
func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }

func TestSchoolCheckin_CheckIn_NewAttendance(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	// The virtual WEB-MANUAL device is per tenant, so this test's own
	// tenant (#2419) needs its own row before a manual check-in.
	_ = testpkg.EnsureWebManualDevice(t, tc.db)

	student := testpkg.CreateTestStudent(t, tc.db, "Checkin", "Target", "1a")
	// Full chain: caller must have a resolvable account → person → staff
	// because the handler resolves the JWT claims through PersonService.
	_, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Checkin", "Caller")

	bodyBytes, _ := json.Marshal(map[string]string{"action": "in"})
	req := testutil.NewRequest("POST", fmt.Sprintf("/%d/school-checkin", student.ID), bytesReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")

	rr := authExec(t, tc, req, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})

	require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())

	var resp struct {
		Data struct {
			Status   string `json:"status"`
			Location string `json:"location"`
			Changed  bool   `json:"changed"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &resp))
	assert.Equal(t, "checked_in", resp.Data.Status)
	assert.Equal(t, "Anwesend", resp.Data.Location)
	assert.True(t, resp.Data.Changed)
}

func TestSchoolCheckin_CheckIn_Idempotent(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	// The virtual WEB-MANUAL device is per tenant, so this test's own
	// tenant (#2419) needs its own row before a manual check-in.
	_ = testpkg.EnsureWebManualDevice(t, tc.db)

	student := testpkg.CreateTestStudent(t, tc.db, "Idem", "Target", "1a")
	_, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Idem", "Caller")

	bodyBytes, _ := json.Marshal(map[string]string{"action": "in"})

	// First call creates the row.
	req1 := testutil.NewRequest("POST", fmt.Sprintf("/%d/school-checkin", student.ID), bytesReader(bodyBytes))
	req1.Header.Set("Content-Type", "application/json")
	rr1 := authExec(t, tc, req1, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr1.Code, "body: %s", rr1.Body.String())

	// Second call with identical action should be a no-op.
	req2 := testutil.NewRequest("POST", fmt.Sprintf("/%d/school-checkin", student.ID), bytesReader(bodyBytes))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := authExec(t, tc, req2, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})

	require.Equal(t, http.StatusOK, rr2.Code)
	var resp struct {
		Data struct {
			Changed bool `json:"changed"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr2.Body.Bytes(), &resp))
	assert.False(t, resp.Data.Changed, "second check-in on already-present student must be no-op")
}

func TestSchoolCheckin_CheckOut_FromCheckedIn(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	// The virtual WEB-MANUAL device is per tenant, so this test's own
	// tenant (#2419) needs its own row before a manual check-in.
	_ = testpkg.EnsureWebManualDevice(t, tc.db)

	student := testpkg.CreateTestStudent(t, tc.db, "Checkout", "Target", "2b")
	_, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Checkout", "Caller")

	// Check in first.
	bodyIn, _ := json.Marshal(map[string]string{"action": "in"})
	reqIn := testutil.NewRequest("POST", fmt.Sprintf("/%d/school-checkin", student.ID), bytesReader(bodyIn))
	reqIn.Header.Set("Content-Type", "application/json")
	rrIn := authExec(t, tc, reqIn, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rrIn.Code, "check-in body: %s", rrIn.Body.String())

	// Now check out.
	bodyOut, _ := json.Marshal(map[string]string{"action": "out"})
	reqOut := testutil.NewRequest("POST", fmt.Sprintf("/%d/school-checkin", student.ID), bytesReader(bodyOut))
	reqOut.Header.Set("Content-Type", "application/json")
	rrOut := authExec(t, tc, reqOut, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})

	require.Equal(t, http.StatusOK, rrOut.Code, "check-out body: %s", rrOut.Body.String())
	var resp struct {
		Data struct {
			Status   string `json:"status"`
			Location string `json:"location"`
			Changed  bool   `json:"changed"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rrOut.Body.Bytes(), &resp))
	assert.Equal(t, "checked_out", resp.Data.Status)
	assert.Equal(t, "Abwesend", resp.Data.Location)
	assert.True(t, resp.Data.Changed)
}

// TestSchoolCheckin_CheckOut_AlsoEndsOpenVisit covers the detailed-mode
// cleanup branch in applySchoolCheckinAction: when the student has an open
// active.visits row, web checkout must end the visit too so supervisor
// views don't keep showing "still in Room X" after attendance is closed.
//
// This branch was previously uncovered because TestSchoolCheckin_CheckOut_FromCheckedIn
// goes through "in" via the school-checkin endpoint, which only writes
// attendance, never a visit. The visit must come from a separate kiosk-side
// fixture for this branch to fire.
func TestSchoolCheckin_CheckOut_AlsoEndsOpenVisit(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)

	student := testpkg.CreateTestStudent(t, tc.db, "Visit", "Cleanup", "2c")
	staff, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Visit", "Caller")

	// Activity infrastructure for the visit. The kiosk path writes
	// active.visits directly via CreateVisit; we shortcut with the test
	// fixture so the integration test stays focused on the handler.
	activityGroup := testpkg.CreateTestActivityGroup(t, tc.db, "School Visit Cleanup")
	room := testpkg.CreateTestRoom(t, tc.db, "Visit Cleanup Room")
	activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, activityGroup.ID, room.ID)

	// Open visit + open attendance — same student, both still active.
	entryTime := time.Now().Add(-30 * time.Minute)
	visit := testpkg.CreateTestVisit(t, tc.db, student.ID, activeGroup.ID, entryTime, nil)

	device := testpkg.CreateTestDevice(t, tc.db, "school-checkin-visit-device")
	checkInTime := time.Now().Add(-30 * time.Minute)
	testpkg.CreateTestAttendance(t, tc.db, student.ID, staff.ID, device.ID, checkInTime, nil)

	// Web checkout — must close attendance AND end the open visit.
	body, _ := json.Marshal(map[string]string{"action": "out"})
	req := testutil.NewRequest("POST", fmt.Sprintf("/%d/school-checkin", student.ID), bytesReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := authExec(t, tc, req, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})

	require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())

	// Confirm the visit is now closed (ExitTime set).
	presence, err := presenceCompose.New(presenceCompose.Dependencies{DB: tc.db, Observe: func(presenceCompose.Observation) {}})
	require.NoError(t, err)
	updatedVisit, err := presence.FindVisit(testpkg.Ctx(t), visit.ID)
	require.NoError(t, err)
	require.NotNil(t, updatedVisit)
	assert.NotNil(t, updatedVisit.ExitTime, "open visit must be closed after web checkout")
}

// TestSchoolCheckin_NonSupervisingStaffAllowed pins the #2329 rule for the web
// check-in: the users:checkin route permission plus a staff identity is the
// whole gate. Supervision of the child's group no longer participates, and the
// per-child attendance.web_checkin_access setting is gone.
func TestSchoolCheckin_NonSupervisingStaffAllowed(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	// The virtual WEB-MANUAL device is per tenant, so this test's own
	// tenant (#2419) needs its own row before a manual check-in.
	_ = testpkg.EnsureWebManualDevice(t, tc.db)

	student := testpkg.CreateTestStudent(t, tc.db, "Allowed", "Target", "3c")
	_, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Allowed", "Caller")

	bodyBytes, _ := json.Marshal(map[string]string{"action": "in"})
	req := testutil.NewRequest("POST", fmt.Sprintf("/%d/school-checkin", student.ID), bytesReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")

	// Non-admin claim: the admin wildcard would pass on its own, so drop it to
	// exercise the plain staff path.
	claims := testutil.AdminTestClaims(int(account.ID))
	claims.Roles = []string{"user"}
	claims.IsAdmin = false
	claims.Permissions = []string{"users:checkin"}

	rr := authExec(t, tc, req, claims, []string{"users:checkin"})

	require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())
}

// TestSchoolCheckin_AccountWithoutStaffRecordDenied is the surviving guard:
// checking children in and out stays with the school's own staff, because the
// attendance row names the person responsible on site (ADR 0089). An account
// without a staff record in the tenant (guest, a school admin without a staff
// profile, a session the Träger-Büro opened through the Absprung) is refused
// with its own code (#7818), not with 401 or a generic 403, and nothing is
// written.
func TestSchoolCheckin_AccountWithoutStaffRecordDenied(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	_ = testpkg.EnsureWebManualDevice(t, tc.db)

	student := testpkg.CreateTestStudent(t, tc.db, "Denied", "Target", "3d")
	account := func(name string) int {
		return int(testpkg.CreateTestAccount(t, tc.db, fmt.Sprintf("school-checkin-%s-%d@example.com", name, testpkg.UniqueSuffix())).ID)
	}
	guest := testutil.AdminTestClaims(account("guest"))
	guest.Roles, guest.IsAdmin = []string{"user"}, false
	admin := testutil.AdminTestClaims(account("admin"))
	_, personAccount := testpkg.CreateTestPersonWithAccount(t, tc.db, "Admin", "OhnePersonal")
	adminWithPerson := testutil.AdminTestClaims(int(personAccount.ID))
	traeger := testutil.AdminTestClaims(account("traeger"))
	traeger.ViaTraeger = true

	callers := map[string]struct {
		claims testpkg.Claims
		perms  []string
	}{
		"guest with users:checkin":    {guest, []string{"users:checkin"}},
		"admin without person":        {admin, []string{"admin:*"}},
		"admin with person, no staff": {adminWithPerson, []string{"admin:*"}},
		"Träger session via Absprung": {traeger, []string{"admin:*"}},
	}
	requests := map[string]struct{ path, body string }{
		"check-in":       {fmt.Sprintf("/%d/school-checkin", student.ID), `{"action":"in"}`},
		"check-out":      {fmt.Sprintf("/%d/school-checkin", student.ID), `{"action":"out"}`},
		"batch check-in": {"/school-checkin/batch", fmt.Sprintf(`{"action":"in","student_ids":["%d"]}`, student.ID)},
	}
	for name, caller := range callers {
		for action, request := range requests {
			req := testutil.NewRequest("POST", request.path, bytesReader([]byte(request.body)))
			req.Header.Set("Content-Type", "application/json")

			rr := authExec(t, tc, req, caller.claims, caller.perms)

			require.Equalf(t, http.StatusForbidden, rr.Code, "%s, %s: %s", name, action, rr.Body.String())
			assert.Containsf(t, rr.Body.String(), `"code":"attendance.checkin_staff_profile_required"`, "%s, %s", name, action)
		}
	}

	var rows int
	require.NoError(t, tc.db.NewRaw(`SELECT count(*) FROM active.attendance WHERE student_id = ?`, student.ID).
		Scan(context.Background(), &rows))
	assert.Zero(t, rows, "a refused check-in or check-out must not write attendance")
}

func TestSchoolCheckin_InvalidAction_Rejects(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)

	student := testpkg.CreateTestStudent(t, tc.db, "Invalid", "Target", "4d")
	_, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Invalid", "Caller")

	bodyBytes, _ := json.Marshal(map[string]string{"action": "toggle"}) // not in | out
	req := testutil.NewRequest("POST", fmt.Sprintf("/%d/school-checkin", student.ID), bytesReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")

	rr := authExec(t, tc, req, testutil.AdminTestClaims(int(account.ID)), []string{"admin:*"})

	assert.Equal(t, http.StatusBadRequest, rr.Code)
	// Body is JSON with escaped quotes (`\"in\"` not `"in"`), so match on
	// the unambiguous prefix rather than the full sentence.
	assert.Contains(t, rr.Body.String(), "action must be")
}
