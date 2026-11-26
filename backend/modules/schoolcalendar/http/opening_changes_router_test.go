package staffcalendarhttp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	apiTest "github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	calendarAPI "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// The opening changes of these tests lie in January 2031.

const openingChangesPath = "/opening-changes/"

type openingChangeBody struct {
	ID        string `json:"id"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	OpensAt   string `json:"opens_at"`
	ClosesAt  string `json:"closes_at"`
	Reason    string `json:"reason"`
	Version   string `json:"version"`
}

type openingChangeError struct {
	Code   string `json:"code"`
	Errors []struct {
		Field string `json:"field"`
	} `json:"errors"`
}

type openingChangeFixture struct {
	router  chi.Router
	account int
	school  int64
}

func newOpeningChangeFixture(t *testing.T) openingChangeFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	inner := chi.NewRouter()
	inner.Mount("/opening-changes", calendarAPI.NewOpeningChangeResource(schoolCalendarCompose.NewOpeningChanges()).Router(rootAPI.ProtectedTenantRoutes))
	account := testpkg.CreateTestAccount(t, db, "opening-changes")
	return openingChangeFixture{router: testpkg.MountedQueryBudgetRouter("/api", inner), account: int(account.ID), school: testpkg.Tenant(t)}
}

// do sends one request in the school with the rights.
func (f openingChangeFixture) do(t *testing.T, school int64, method, path string, body any, rights ...string) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	request := httptest.NewRequest(method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	return apiTest.ExecuteWithAuth(t, f.router, request, apiTest.TenantUserTestClaims(f.account, school, rights...))
}

func (f openingChangeFixture) list(t *testing.T, school int64) []openingChangeBody {
	t.Helper()
	rec := f.do(t, school, http.MethodGet, openingChangesPath+"?from=2031-01-01&to=2031-01-31", nil, permissions.SchedulesRead)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeOpeningChangeData[[]openingChangeBody](t, rec)
}

func (f openingChangeFixture) create(t *testing.T, day, reason string) openingChangeBody {
	t.Helper()
	rec := f.do(t, f.school, http.MethodPost, openingChangesPath, shortDay(day, reason), permissions.SchedulesCreate)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	return decodeOpeningChangeData[openingChangeBody](t, rec)
}

func shortDay(day, reason string) map[string]any {
	return map[string]any{"start_date": day, "end_date": day, "opens_at": "07:30", "closes_at": "12:00", "reason": reason}
}

func decodeOpeningChangeData[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var envelope struct {
		Data T `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	return envelope.Data
}

func decodeOpeningChangeError(t *testing.T, rec *httptest.ResponseRecorder) openingChangeError {
	t.Helper()
	var body openingChangeError
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body), rec.Body.String())
	return body
}

// The school enters a shorter day, reads it, changes it in the version it
// read and deletes it; a change on a stale version is refused.
func TestOpeningChangesRoundTrip(t *testing.T) {
	t.Parallel()
	f := newOpeningChangeFixture(t)

	created := f.create(t, "2031-01-17", " Zeugnisausgabe ")
	assert.Equal(t, "2031-01-17", created.StartDate)
	assert.Equal(t, "07:30", created.OpensAt)
	assert.Equal(t, "12:00", created.ClosesAt)
	assert.Equal(t, "Zeugnisausgabe", created.Reason, "the name is trimmed")
	assert.NotEmpty(t, created.Version)
	require.Equal(t, []openingChangeBody{created}, f.list(t, f.school))

	change := map[string]any{"start_date": "2031-01-16", "end_date": "2031-01-17", "opens_at": "08:00", "closes_at": "13:15",
		"reason": "Zeugnisse", "expected_version": created.Version}
	rec := f.do(t, f.school, http.MethodPut, openingChangesPath+created.ID, change, permissions.SchedulesUpdate)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	updated := decodeOpeningChangeData[openingChangeBody](t, rec)
	assert.Equal(t, "2031-01-16", updated.StartDate)
	assert.Equal(t, "13:15", updated.ClosesAt)

	rec = f.do(t, f.school, http.MethodPut, openingChangesPath+created.ID, change, permissions.SchedulesUpdate)
	require.Equal(t, http.StatusConflict, rec.Code, "the version read before the change is stale: %s", rec.Body.String())

	rec = f.do(t, f.school, http.MethodDelete, openingChangesPath+created.ID, nil, permissions.SchedulesDelete)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Empty(t, f.list(t, f.school))
	rec = f.do(t, f.school, http.MethodDelete, openingChangesPath+created.ID, nil, permissions.SchedulesDelete)
	require.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	assert.Equal(t, "calendar.opening_change_not_found", decodeOpeningChangeError(t, rec).Code)
}

// Reading needs schedules:read, each write its own right, as on the
// closing days.
func TestOpeningChangesNeedTheRightsOfTheClosingDays(t *testing.T) {
	t.Parallel()
	f := newOpeningChangeFixture(t)
	created := f.create(t, "2031-01-10", "Teamtag")
	path := openingChangesPath + created.ID
	update := map[string]any{"start_date": "2031-01-10", "end_date": "2031-01-10", "opens_at": "07:30", "closes_at": "11:00",
		"reason": "Teamtag", "expected_version": created.Version}

	for _, call := range []struct {
		method, path string
		body         any
		missing      string
	}{
		{http.MethodGet, openingChangesPath + "?from=2031-01-01&to=2031-01-31", nil, permissions.SchedulesRead},
		{http.MethodPost, openingChangesPath, shortDay("2031-01-11", "Ausflug"), permissions.SchedulesCreate},
		{http.MethodPut, path, update, permissions.SchedulesUpdate},
		{http.MethodDelete, path, nil, permissions.SchedulesDelete},
	} {
		// Every right but the one the route needs.
		others := []string{}
		for _, right := range []string{permissions.SchedulesRead, permissions.SchedulesCreate, permissions.SchedulesUpdate, permissions.SchedulesDelete} {
			if right != call.missing {
				others = append(others, right)
			}
		}
		rec := f.do(t, f.school, call.method, call.path, call.body, others...)
		assert.Equalf(t, http.StatusForbidden, rec.Code, "%s %s without %s: %s", call.method, call.path, call.missing, rec.Body.String())
	}
	assert.Equal(t, []openingChangeBody{created}, f.list(t, f.school), "no refused write changed the day")
}

// Another school neither reads nor changes nor deletes the day.
func TestOpeningChangesStayInTheirSchool(t *testing.T) {
	t.Parallel()
	f := newOpeningChangeFixture(t)
	created := f.create(t, "2031-01-20", "Elternabend")
	foreign := testpkg.NewTenantScope(t, testpkg.SetupTestDB(t)).TenantID
	path := openingChangesPath + created.ID

	assert.Empty(t, f.list(t, foreign))
	update := map[string]any{"start_date": "2031-01-20", "end_date": "2031-01-20", "opens_at": "07:00", "closes_at": "10:00",
		"reason": "Übernommen", "expected_version": created.Version}
	rec := f.do(t, foreign, http.MethodPut, path, update, permissions.SchedulesUpdate)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	rec = f.do(t, foreign, http.MethodDelete, path, nil, permissions.SchedulesDelete)
	assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
	assert.Equal(t, []openingChangeBody{created}, f.list(t, f.school), "the school's day is unchanged")
}

// A change that is none is refused at its field.
func TestOpeningChangesRefuseAnInvalidDay(t *testing.T) {
	t.Parallel()
	f := newOpeningChangeFixture(t)
	for name, test := range map[string]struct {
		change map[string]any
		field  string
	}{
		"closes before it opens": {map[string]any{"start_date": "2031-01-08", "end_date": "2031-01-08", "opens_at": "12:00", "closes_at": "12:00", "reason": "Kurz"}, "closes_at"},
		"ends before it starts":  {map[string]any{"start_date": "2031-01-09", "end_date": "2031-01-08", "opens_at": "07:00", "closes_at": "12:00", "reason": "Kurz"}, "end_date"},
		"no name":                {map[string]any{"start_date": "2031-01-08", "end_date": "2031-01-08", "opens_at": "07:00", "closes_at": "12:00", "reason": "  "}, "reason"},
		"no time":                {map[string]any{"start_date": "2031-01-08", "end_date": "2031-01-08", "opens_at": "7 Uhr", "closes_at": "12:00", "reason": "Kurz"}, "opens_at"},
	} {
		rec := f.do(t, f.school, http.MethodPost, openingChangesPath, test.change, permissions.SchedulesCreate)
		require.Equalf(t, http.StatusBadRequest, rec.Code, "%s: %s", name, rec.Body.String())
		body := decodeOpeningChangeError(t, rec)
		assert.Equal(t, "calendar.opening_change_invalid", body.Code, name)
		require.Lenf(t, body.Errors, 1, name)
		assert.Equal(t, test.field, body.Errors[0].Field, name)
	}
	assert.Empty(t, f.list(t, f.school))
}

// The list reads a fixed number of statements, however many days it holds.
func TestOpeningChangesListQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	f := newOpeningChangeFixture(t)
	counter := testpkg.CaptureQueriesForContext(t, db)
	created, small := 0, 0
	for _, n := range []int{3, 8} {
		for created < n {
			f.create(t, calendar.NewDate(2031, 1, 2).AddDays(created*3).String(), fmt.Sprintf("Tag %d", created))
			created++
		}
		counter.Reset()
		request := httptest.NewRequestWithContext(counter.Context(context.Background()), http.MethodGet, openingChangesPath+"?from=2031-01-01&to=2031-01-31", nil)
		rec := apiTest.ExecuteWithAuth(t, f.router, request, apiTest.TenantUserTestClaims(f.account, f.school, permissions.SchedulesRead))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		require.Len(t, decodeOpeningChangeData[[]openingChangeBody](t, rec), n)
		require.Zero(t, counter.WriteRows())
		if n == 3 {
			small = counter.Total()
		} else {
			require.Equal(t, small, counter.Total())
		}
		t.Logf("opening changes N%d statements=%d", n, counter.Total())
		querybudgets.AssertQueryBudget(t, "api.opening_changes.list", counter.Measurement(counter.Queries()))
	}
}
