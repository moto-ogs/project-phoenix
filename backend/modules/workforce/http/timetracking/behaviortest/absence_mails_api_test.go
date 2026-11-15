// Router-level tests for the mail status of absence requests (#7058):
// GET /api/staff/absences/mails and GET /api/time-tracking/absences/mails,
// over Delivery's real outbox and outcome read.
package behaviortest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/http/absencetypes"
	timetracking "github.com/moto-ogs/project-phoenix/modules/workforce/http/timetracking"
	"github.com/moto-ogs/project-phoenix/modules/workforce/workforcetest"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

// Delivery's related types of the absence mails, as the notifications name
// them.
const (
	mailRequestReceived = "absence_request_received"
	mailRequestApproved = "absence_request_approved"
	mailRequestQuestion = "absence_request_question"
)

func enqueueAbsenceMail(t *testing.T, db *bun.DB, outbox workforcetest.MailOutbox, relatedType string, absenceID int64, address string) {
	t.Helper()
	require.NoError(t, tenant.WithTenantTx(testpkg.Ctx(t), db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		return outbox.Enqueue(txCtx, relatedType, absenceID, address)
	}))
}

func mailAddress(name string) string {
	return fmt.Sprintf("%s-%d@example.test", name, testpkg.UniqueSuffix())
}

func setupAbsenceMailRoute(t *testing.T) (*testContext, workforcetest.MailOutbox) {
	t.Helper()
	var outbox workforcetest.MailOutbox
	tc := setupStaffRouteWith(t, func(db *bun.DB, deps *timetracking.StaffAdminDependencies) {
		outbox = workforcetest.ComposeMailOutbox(t, db)
		deps.AbsenceMails = outbox.Status
	})
	return tc, outbox
}

func getAbsenceDecisionMails(t *testing.T, router http.Handler, token string, ids ...int64) (*httptest.ResponseRecorder, map[string]string) {
	t.Helper()
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatInt(id, 10)
	}
	req := httptest.NewRequest(http.MethodGet, "/staff/absences/mails?ids="+strings.Join(parts, ","), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		return rec, nil
	}
	var body struct {
		Data timetracking.AbsenceDecisionMailsResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return rec, body.Data.Absences
}

// The Leitung sees whether the decision reached the applicant, the newest
// decision mail per request; another school's requests stay unknown.
func TestAbsenceDecisionMailsShowTheNewestDecision(t *testing.T) {
	t.Parallel()
	tc, outbox := setupAbsenceMailRoute(t)
	applicant := testpkg.CreateTestStaff(t, tc.db, "Mail", "Applicant")
	decider := testpkg.CreateTestStaff(t, tc.db, "Mail", "Decider")
	address := mailAddress("applicant")
	approved := createAbsence(t, tc, applicant.ID, absenceTypeVacation, absenceStatusApprovd, &decider.ID)
	questioned := createAbsence(t, tc, applicant.ID, absenceTypeVacation, absenceStatusQuestn, nil)
	silent := createAbsence(t, tc, applicant.ID, absenceTypeVacation, absenceStatusReqd, nil)
	enqueueAbsenceMail(t, tc.db, outbox, mailRequestQuestion, approved, address)
	enqueueAbsenceMail(t, tc.db, outbox, mailRequestApproved, approved, address)
	enqueueAbsenceMail(t, tc.db, outbox, mailRequestQuestion, questioned, address)
	// The notice to the Leitung is no decision mail.
	enqueueAbsenceMail(t, tc.db, outbox, mailRequestReceived, silent, mailAddress("leitung"))
	_, err := tc.db.NewRaw(`UPDATE platform.email_outbox SET status = 'sent', sent_at = now(), delivery_state = 'failed', delivery_state_at = now()
		WHERE related_entity_type = ? AND related_entity_id = ?`, mailRequestApproved, approved).Exec(testpkg.Ctx(t))
	require.NoError(t, err)

	token := authToken(t, "vacation:approve")
	rec, mails := getAbsenceDecisionMails(t, tc.router, token, approved, questioned, silent)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Equal(t, map[string]string{
		strconv.FormatInt(approved, 10):   "undeliverable",
		strconv.FormatInt(questioned, 10): "queued",
	}, mails)

	rec, _ = getAbsenceDecisionMails(t, tc.router, authToken(t, "time_tracking:own"), approved)
	require.Equal(t, http.StatusForbidden, rec.Code, "only who decides reads the decision mails")
	req := httptest.NewRequest(http.MethodGet, "/staff/absences/mails?ids=1,abc", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	bad := httptest.NewRecorder()
	tc.router.ServeHTTP(bad, req)
	require.Equal(t, http.StatusBadRequest, bad.Code, bad.Body.String())

	// Another school's decision mail stays unknown, even by its ID.
	foreign := testpkg.NewTenantScope(t, tc.db)
	foreignStaff := testpkg.CreateTestStaffForTenant(t, tc.db, foreign.TenantID, "Foreign", "Applicant")
	foreignRow := map[string]any{"tenant_id": foreign.TenantID, "staff_id": foreignStaff.ID, "created_by": foreignStaff.ID, "absence_type": absenceTypeVacation,
		"status": absenceStatusApprovd, "date_start": "2099-04-01", "date_end": "2099-04-01", "requested_at": time.Now()}
	var foreignAbsence int64
	require.NoError(t, tc.db.NewInsert().Model(&foreignRow).TableExpr("active.staff_absences").Returning("id").Scan(testpkg.Ctx(t), &foreignAbsence))
	require.NoError(t, tenant.WithTenantTx(foreign.Context(), tc.db, foreign.TenantID, func(txCtx context.Context, _ bun.Tx) error {
		return outbox.Enqueue(txCtx, mailRequestApproved, foreignAbsence, mailAddress("foreign"))
	}))
	rec, mails = getAbsenceDecisionMails(t, tc.router, token, approved, foreignAbsence)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Equal(t, map[string]string{strconv.FormatInt(approved, 10): "undeliverable"}, mails, "another school's mail stays out")
}

// One outcome read per mail type, whatever the number of requests.
func TestAbsenceDecisionMailsPositiveGrowthQueryBudget(t *testing.T) {
	t.Parallel()
	testpkg.OwnTenant(t)
	testpkg.SetupIsolatedTestDB(t)
	tc, outbox := setupAbsenceMailRoute(t)
	router := testpkg.MountedQueryBudgetRouter("/api", tc.router)
	applicant := testpkg.CreateTestStaff(t, tc.db, "Budget", "Applicant")
	decider := testpkg.CreateTestStaff(t, tc.db, "Budget", "Decider")
	token := authToken(t, "vacation:approve")
	var ids []int64
	counts := []int{}
	for _, n := range []int{3, 8} {
		for len(ids) < n {
			id := createAbsence(t, tc, applicant.ID, absenceTypeVacation, absenceStatusApprovd, &decider.ID)
			enqueueAbsenceMail(t, tc.db, outbox, mailRequestApproved, id, mailAddress("budget"))
			ids = append(ids, id)
		}
		parts := make([]string, len(ids))
		for i, id := range ids {
			parts[i] = strconv.FormatInt(id, 10)
		}
		req := httptest.NewRequest(http.MethodGet, "/staff/absences/mails?ids="+strings.Join(parts, ","), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		counter := testpkg.CaptureQueries(t, tc.db)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req)
		counter.Stop()
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var body struct {
			Data timetracking.AbsenceDecisionMailsResponse `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		require.Len(t, body.Data.Absences, n)
		for _, outcome := range body.Data.Absences {
			require.Equal(t, "queued", outcome)
		}
		queries := counter.Measurement(counter.Queries())
		counts = append(counts, len(queries.Statements))
		querybudgets.AssertQueryBudget(t, "workforce.staff_growth.absence_decision_mails", queries)
	}
	require.Equal(t, counts[0], counts[1])
}

func newOwnAbsenceMailRouter(t *testing.T) (*bun.DB, http.Handler, workforcetest.MailOutbox) {
	t.Helper()
	db, caps := workforcetest.ComposeAdmin(t)
	outbox := workforcetest.ComposeMailOutbox(t, db)
	capability := newWorkforceCapability(t, db)
	resource := timetracking.NewResource(timetracking.Dependencies{WorkSessions: caps.WorkSessions, StaffAbsences: caps.StaffAbsences, AbsenceWrites: caps.AbsenceWrites, Staff: caps.Staff, WorkTimeMonth: caps.WorkTimeMonth, Allowances: capability, AllowanceResponses: func(accounts []workforce.AbsenceTypeAllowanceAccount) any {
		return absencetypes.ToOwnAllowanceResponses(accounts)
	}, Identity: testIdentity, WithinTenant: testWithinTenant(db), AbsenceMails: outbox.Status})
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/time-tracking", resource.Router(timetracking.ScopeTestTenantRoutes(testpkg.TenantSessionGatesWithCaches(scopeTestSettingsCache))))
	return db, router, outbox
}

func insertOwnAbsence(t *testing.T, db *bun.DB, staffID int64, status string, day int) int64 {
	t.Helper()
	row := map[string]any{"tenant_id": testpkg.Tenant(t), "staff_id": staffID, "created_by": staffID, "absence_type": absenceTypeVacation, "status": status,
		"date_start": fmt.Sprintf("2099-03-%02d", day), "date_end": fmt.Sprintf("2099-03-%02d", day), "requested_at": time.Now()}
	var id int64
	require.NoError(t, db.NewInsert().Model(&row).TableExpr("active.staff_absences").Returning("id").Scan(testpkg.Ctx(t), &id))
	return id
}

func getOwnAbsenceMails(t *testing.T, router http.Handler, token string) map[string]map[string]int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/time-tracking/absences/mails", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var body struct {
		Data timetracking.AbsenceRequestMailsResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return body.Data.Absences
}

// The applicant sees, for each own request still waiting, whether the
// Leitung got the notice by mail; decided requests and other people's
// requests stay out.
func TestOwnAbsenceRequestMailsCountTheNoticeToTheLeitung(t *testing.T) {
	t.Parallel()
	db, router, outbox := newOwnAbsenceMailRouter(t)
	staff, account := testpkg.CreateTestStaffWithAccount(t, db, "Own", "Applicant")
	other := testpkg.CreateTestStaff(t, db, "Other", "Applicant")
	waiting := insertOwnAbsence(t, db, staff.ID, absenceStatusReqd, 1)
	decided := insertOwnAbsence(t, db, staff.ID, absenceStatusApprovd, 2)
	foreignRequest := insertOwnAbsence(t, db, other.ID, absenceStatusReqd, 3)
	for _, id := range []int64{waiting, decided, foreignRequest} {
		enqueueAbsenceMail(t, db, outbox, mailRequestReceived, id, mailAddress("lea"))
		enqueueAbsenceMail(t, db, outbox, mailRequestReceived, id, mailAddress("max"))
	}
	_, err := db.NewRaw(`UPDATE platform.email_outbox SET status = 'sent', sent_at = now(), delivery_state = 'failed', delivery_state_at = now()
		WHERE id = (SELECT MIN(id) FROM platform.email_outbox WHERE related_entity_type = ? AND related_entity_id = ?)`, mailRequestReceived, waiting).Exec(testpkg.Ctx(t))
	require.NoError(t, err)

	mails := getOwnAbsenceMails(t, router, ownToken(t, account.ID, 0, "time_tracking:own"))
	require.Equal(t, map[string]map[string]int{strconv.FormatInt(waiting, 10): {"undeliverable": 1, "queued": 1}}, mails)
}

// One own-list read and one outcome read per mail type, flat in requests.
func TestOwnAbsenceRequestMailsPositiveGrowthQueryBudget(t *testing.T) {
	t.Parallel()
	testpkg.OwnTenant(t)
	testpkg.SetupIsolatedTestDB(t)
	db, router, outbox := newOwnAbsenceMailRouter(t)
	router = testpkg.MountedQueryBudgetRouter("/api", router)
	staff, account := testpkg.CreateTestStaffWithAccount(t, db, "Own", "Budget")
	token := ownToken(t, account.ID, 0, "time_tracking:own")
	var ids []int64
	counts := []int{}
	for _, n := range []int{3, 8} {
		for len(ids) < n {
			id := insertOwnAbsence(t, db, staff.ID, absenceStatusReqd, len(ids)+1)
			enqueueAbsenceMail(t, db, outbox, mailRequestReceived, id, mailAddress("lea"))
			ids = append(ids, id)
		}
		req := httptest.NewRequest(http.MethodGet, "/time-tracking/absences/mails", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		counter := testpkg.CaptureQueries(t, db)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req)
		counter.Stop()
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var body struct {
			Data timetracking.AbsenceRequestMailsResponse `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		require.Len(t, body.Data.Absences, n)
		for _, counts := range body.Data.Absences {
			require.Equal(t, map[string]int{"queued": 1}, counts)
		}
		queries := counter.Measurement(counter.Queries())
		counts = append(counts, len(queries.Statements))
		querybudgets.AssertQueryBudget(t, "workforce.workforce20.own_absence_mails", queries)
	}
	require.Equal(t, counts[0], counts[1])
}
