package behaviortest

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These routes reach the browser through the catalog proxy (#2352); the test
// drives them under their production path /api/staff and reads every answer
// back from the stored state.

// workflowRoutesNow is the fixed instant the routes run at: a school Tuesday
// afternoon in November 2026.
var workflowRoutesNow = testpkg.Date(2026, time.November, 10).BerlinMidnight().Add(14 * time.Hour)

type workflowRoutes struct {
	tc     *testContext
	editor int64
	token  string
}

func setupWorkflowRoutes(t *testing.T) *workflowRoutes {
	t.Helper()
	tc := setupStaffRoute(t, func() time.Time { return workflowRoutesNow })
	tc.router = testpkg.MountedQueryBudgetRouter("/api", tc.router)
	person, account := testpkg.CreateTestPersonWithAccount(t, tc.db, "Ablauf", fmt.Sprintf("Leitung-%d", testpkg.UniqueSuffix()))
	editor := testpkg.CreateTestStaffForPerson(t, tc.db, person.ID)
	claims := testutil.DefaultTestClaims()
	claims.ID = int(account.ID)
	claims.Permissions = []string{"time_tracking:manage", "vacation:approve"}
	return &workflowRoutes{tc: tc, editor: editor.ID, token: testutil.MintTestJWT(t, claims)}
}

func (w *workflowRoutes) do(method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+w.token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	w.tc.router.ServeHTTP(rec, req)
	return rec
}

func (w *workflowRoutes) absenceStatus(t *testing.T, absenceID int64) string {
	t.Helper()
	var status string
	require.NoError(t, w.tc.db.NewSelect().TableExpr("active.staff_absences").Column("status").
		Where("id = ?", absenceID).Scan(testpkg.Ctx(t), &status))
	return status
}

// The Leitung approves one requested vacation and declines another; each
// answer names the decided absence and the stored status follows.
func TestAbsenceDecisionsAnswerWithTheDecidedAbsence(t *testing.T) {
	t.Parallel()
	w := setupWorkflowRoutes(t)
	subject := testpkg.CreateTestStaff(t, w.tc.db, "Antrag", fmt.Sprintf("Person-%d", testpkg.UniqueSuffix()))
	request := func(start string) int64 {
		return insertAbsenceRow(t, w.tc, map[string]any{
			"staff_id": subject.ID, "absence_type": absenceTypeVacation, "date_start": start, "date_end": start,
			"status": absenceStatusReqd, "created_by": subject.ID, "requested_at": workflowRoutesNow,
		})
	}
	approved, declined := request("2026-11-23"), request("2026-11-24")

	rec := w.do(http.MethodPost, fmt.Sprintf("/staff/absences/%d/approve", approved), `{"decision_note":"Passt"}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	answer := decodeContractData[struct {
		ID     int64  `json:"id"`
		Status string `json:"status"`
	}](t, rec)
	assert.Equal(t, approved, answer.ID)
	assert.Equal(t, absenceStatusApprovd, answer.Status)
	assert.Equal(t, absenceStatusApprovd, w.absenceStatus(t, approved))

	rec = w.do(http.MethodPost, fmt.Sprintf("/staff/absences/%d/deny", declined), `{"decision_note":"Zu knapp besetzt"}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	denied := decodeContractData[struct {
		ID           int64  `json:"id"`
		DecisionNote string `json:"decision_note"`
	}](t, rec)
	assert.Equal(t, declined, denied.ID)
	assert.Equal(t, "Zu knapp besetzt", denied.DecisionNote)
	assert.NotEqual(t, absenceStatusReqd, w.absenceStatus(t, declined))
}

// The takeover at the moto introduction books a Resturlaub and an opening
// balance, and its deletion removes the vacation row again.
func TestTakeoverRoutesBookAndRemoveTheOpenings(t *testing.T) {
	t.Parallel()
	w := setupWorkflowRoutes(t)
	subject := testpkg.CreateTestStaff(t, w.tc.db, "Uebernahme", fmt.Sprintf("Person-%d", testpkg.UniqueSuffix()))
	base := fmt.Sprintf("/staff/%d", subject.ID)

	rec := w.do(http.MethodPost, base+"/vacation/opening", `{"effective_date":"2026-11-09","remaining_days":12,"note":"Altsystem"}`)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	opening := decodeContractData[struct {
		StaffID   int64   `json:"staff_id"`
		Year      int     `json:"year"`
		Remaining float64 `json:"entered_remaining_days"`
	}](t, rec)
	assert.Equal(t, subject.ID, opening.StaffID)
	assert.Equal(t, 2026, opening.Year)
	assert.InDelta(t, 12, opening.Remaining, 0.001)

	rec = w.do(http.MethodDelete, base+"/vacation/opening?year=2026", "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = w.do(http.MethodDelete, base+"/vacation/opening?year=2026", "")
	require.Equal(t, http.StatusNotFound, rec.Code, "the takeover is gone: %s", rec.Body.String())

	rec = w.do(http.MethodPost, base+"/time-tracking/opening", `{"effective_date":"2026-11-02","balance_minutes":90,"note":"Altsystem"}`)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	balance := decodeContractData[struct {
		StaffID int64  `json:"staff_id"`
		Type    string `json:"type"`
		Delta   int    `json:"minutes_delta"`
	}](t, rec)
	assert.Equal(t, subject.ID, balance.StaffID)
	assert.Equal(t, "opening", balance.Type)
	assert.Equal(t, 90, balance.Delta)
}

// The Monatsabschluss freezes a finished month, the status lists the frozen
// rows, and reopening one staff member's month removes that row.
func TestMonthCloseRoutesFreezeListAndReopen(t *testing.T) {
	t.Parallel()
	w := setupWorkflowRoutes(t)

	rec := w.do(http.MethodPost, "/staff/time-tracking/month-close", `{"year":2026,"month":10,"reason":"Oktober fertig"}`)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	closed := decodeContractData[struct {
		Month       int `json:"month"`
		ClosedStaff int `json:"closed_staff"`
	}](t, rec)
	assert.Equal(t, 10, closed.Month)
	require.Positive(t, closed.ClosedStaff)

	type snapshot struct {
		StaffID int64  `json:"staff_id"`
		Reason  string `json:"close_reason"`
	}
	rec = w.do(http.MethodGet, "/staff/time-tracking/month-close?year=2026&month=10", "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rows := decodeContractData[[]snapshot](t, rec)
	require.NotEmpty(t, rows)
	assert.Equal(t, "Oktober fertig", rows[0].Reason)

	reopened := rows[0].StaffID
	rec = w.do(http.MethodPost, fmt.Sprintf("/staff/%d/time-tracking/month-close/reopen", reopened), `{"year":2026,"month":10,"reason":"Korrektur"}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	rec = w.do(http.MethodGet, "/staff/time-tracking/month-close?year=2026&month=10", "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	for _, row := range decodeContractData[[]snapshot](t, rec) {
		assert.NotEqual(t, reopened, row.StaffID, "the reopened month is no longer frozen")
	}
}
