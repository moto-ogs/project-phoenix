package staffcalendarhttp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	apiTest "github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	calendarAPI "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

// The opening changes of a Träger (#8202) in these tests lie in February 2031.

const traegerOpeningChangesPath = "/traeger/opening-changes/"

type traegerOpeningChangeBody struct {
	openingChangeBody
	SchoolIDs []string `json:"school_ids"`
	Traeger   bool     `json:"traeger"`
}

// traegerDirectorySchools names the undeleted schools of a Träger as
// platform.schools holds them, as the root's binding does.
type traegerDirectorySchools struct{ db *bun.DB }

func (s traegerDirectorySchools) TraegerSchools(ctx context.Context, organizationID int64) ([]traegercalendar.SchoolState, error) {
	var schools []traegercalendar.SchoolState
	err := s.db.NewRaw(`SELECT id, name FROM platform.schools WHERE organization_id = ? AND deleted_at IS NULL ORDER BY id`, organizationID).Scan(ctx, &schools)
	return schools, err
}

type traegerOpeningFixture struct {
	db                     *bun.DB
	router                 chi.Router
	account                int
	traeger, other         int64
	named, unnamed, abroad int64
}

// newTraegerOpeningFixture builds a Träger with a named and an unnamed
// school and another Träger with its own school, behind the Träger routes
// and the school's own routes.
func newTraegerOpeningFixture(t *testing.T, db *bun.DB) traegerOpeningFixture {
	t.Helper()
	organization := func(name string) int64 {
		id := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: name, Slug: fmt.Sprintf("oeffnung-%d", testpkg.UniqueTestTenantID(t))}).ID
		testpkg.OwnTraegerOpeningChanges(t, db, id)
		return id
	}
	f := traegerOpeningFixture{db: db, account: int(testpkg.CreateTestAccount(t, db, "traeger-opening").ID)}
	f.traeger, f.other = organization("Träger Öffnung"), organization("Träger Öffnung Fremd")
	f.named = testpkg.CreateTestSchoolInOrganization(t, db, f.traeger, "OGS Genannt")
	f.unnamed = testpkg.CreateTestSchoolInOrganization(t, db, f.traeger, "OGS Ungenannt")
	f.abroad = testpkg.CreateTestSchoolInOrganization(t, db, f.other, "OGS Fremd")
	inner := chi.NewRouter()
	inner.Mount("/opening-changes", calendarAPI.NewOpeningChangeResource(schoolCalendarCompose.NewOpeningChanges()).Router(rootAPI.ProtectedTenantRoutes))
	f.router = chi.NewRouter()
	f.router.Mount("/api", inner)
	f.router.Mount("/traeger/opening-changes", traegerOpeningChangeRoutes(db))
	return f
}

func traegerOpeningChangeRoutes(db *bun.DB) chi.Router {
	return rootAPI.TraegerOpeningChangeRouter(traegerDirectorySchools{db: db})
}

func (f traegerOpeningFixture) send(t *testing.T, claims testpkg.Claims, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	request := httptest.NewRequest(method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	return apiTest.ExecuteWithAuth(t, f.router, request, claims)
}

// office is a session of the Träger-Büro of organizationID with role.
func (f traegerOpeningFixture) office(organizationID int64, role string) testpkg.Claims {
	roles := []string{role}
	return testpkg.TraegerTestClaims(f.account, organizationID, roles, identityaccess.TraegerRights(roles))
}

func (f traegerOpeningFixture) school(school int64, rights ...string) testpkg.Claims {
	return apiTest.TenantUserTestClaims(f.account, school, rights...)
}

func traegerShortDay(reason string, schools ...int64) map[string]any {
	ids := make([]string, 0, len(schools))
	for _, id := range schools {
		ids = append(ids, fmt.Sprint(id))
	}
	return map[string]any{"start_date": "2031-02-07", "end_date": "2031-02-07", "opens_at": "07:30", "closes_at": "12:00", "reason": reason, "school_ids": ids}
}

func schoolShortDay(reason string) map[string]any {
	return map[string]any{"start_date": "2031-02-07", "end_date": "2031-02-07", "opens_at": "07:30", "closes_at": "12:00", "reason": reason}
}

// closingTime reads the closing time of 2031-02-07 in the school's tenant
// transaction, as the session end, the care day and the parents' deadline
// read it.
func (f traegerOpeningFixture) closingTime(t *testing.T, school int64) (string, bool) {
	t.Helper()
	var closesAt string
	var ok bool
	require.NoError(t, testpkg.WithinTenantContext(t, context.Background(), f.db, school, func(txCtx context.Context) error {
		var err error
		closesAt, ok, err = schoolCalendarCompose.NewOpeningChanges().ClosingTimeOn(txCtx, calendar.NewDate(2031, time.February, 7))
		return err
	}))
	return closesAt, ok
}

func (f traegerOpeningFixture) schoolList(t *testing.T, school int64) []traegerOpeningChangeBody {
	t.Helper()
	rec := f.send(t, f.school(school, permissions.SchedulesRead), http.MethodGet, "/api/opening-changes/?from=2031-02-01&to=2031-02-28", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return decodeOpeningChangeData[[]traegerOpeningChangeBody](t, rec)
}

// The Träger-Büro plans a shorter day for one of its schools: the named
// school reads it as „Vom Träger“ and closes earlier, the unnamed school
// keeps operations.session_end_time, and nobody outside the Träger reaches it.
func TestTraegerOpeningChangeReachesOnlyTheNamedSchool(t *testing.T) {
	t.Parallel()
	f := newTraegerOpeningFixture(t, testpkg.SetupTestDB(t))
	admin := f.office(f.traeger, identityaccess.TraegerRoleAdministration)

	rec := f.send(t, f.office(f.traeger, identityaccess.TraegerRoleReadOnly), http.MethodPost, traegerOpeningChangesPath, traegerShortDay("Zeugnisausgabe", f.named))
	assert.Equal(t, http.StatusForbidden, rec.Code, "reading the overview is no right to plan: %s", rec.Body.String())
	rec = f.send(t, admin, http.MethodPost, traegerOpeningChangesPath, traegerShortDay("Fremd", f.abroad))
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Equal(t, "traeger.closing_day_school_outside", decodeOpeningChangeError(t, rec).Code, "a school of another Träger cannot be named")
	rec = f.send(t, admin, http.MethodPost, traegerOpeningChangesPath, traegerShortDay("Ohne Schule"))
	require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	assert.Equal(t, "traeger.opening_change_invalid", decodeOpeningChangeError(t, rec).Code)

	rec = f.send(t, admin, http.MethodPost, traegerOpeningChangesPath, traegerShortDay(" Zeugnisausgabe ", f.named))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	created := decodeOpeningChangeData[traegerOpeningChangeBody](t, rec)
	assert.Equal(t, "Zeugnisausgabe", created.Reason)
	assert.Equal(t, []string{fmt.Sprint(f.named)}, created.SchoolIDs)
	path := traegerOpeningChangesPath + created.ID

	closesAt, ok := f.closingTime(t, f.named)
	assert.True(t, ok)
	assert.Equal(t, "12:00", closesAt, "the named school's sessions end at the Träger's closing time")
	_, ok = f.closingTime(t, f.unnamed)
	assert.False(t, ok, "an unnamed school keeps operations.session_end_time")
	_, ok = f.closingTime(t, f.abroad)
	assert.False(t, ok, "a school of another Träger keeps its session end")

	listed := f.schoolList(t, f.named)
	require.Len(t, listed, 1)
	assert.True(t, listed[0].Traeger, "the school sees the change as the Träger's")
	assert.Equal(t, "Zeugnisausgabe", listed[0].Reason)
	assert.Empty(t, f.schoolList(t, f.unnamed))
	rec = f.send(t, f.school(f.named, permissions.SchedulesUpdate), http.MethodPut, "/api/opening-changes/"+created.ID, traegerShortDay("Schule"))
	assert.Equal(t, http.StatusNotFound, rec.Code, "the school cannot change the Träger's change: %s", rec.Body.String())
	rec = f.send(t, f.school(f.named, permissions.SchedulesDelete), http.MethodDelete, "/api/opening-changes/"+created.ID, nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, "the school cannot delete it either: %s", rec.Body.String())

	foreign := f.office(f.other, identityaccess.TraegerRoleAdministration)
	rec = f.send(t, foreign, http.MethodGet, traegerOpeningChangesPath+"?from=2031-02-01&to=2031-02-28", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Empty(t, decodeOpeningChangeData[[]traegerOpeningChangeBody](t, rec), "another Träger reads nothing")
	update := traegerShortDay("Fremd", f.named)
	update["expected_version"] = created.Version
	rec = f.send(t, foreign, http.MethodPut, path, update)
	assert.Equal(t, http.StatusBadRequest, rec.Code, "another Träger cannot name the school: %s", rec.Body.String())
	update = traegerShortDay("Fremd", f.abroad)
	update["expected_version"] = created.Version
	rec = f.send(t, foreign, http.MethodPut, path, update)
	assert.Equal(t, http.StatusNotFound, rec.Code, "another Träger cannot change it: %s", rec.Body.String())
	rec = f.send(t, foreign, http.MethodDelete, path, nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, "another Träger cannot delete it: %s", rec.Body.String())

	// The Träger moves the change to both schools in the version it read.
	update = traegerShortDay("Zeugnisausgabe", f.named, f.unnamed)
	update["closes_at"] = "11:30"
	rec = f.send(t, admin, http.MethodPut, path, update)
	assert.Equal(t, http.StatusConflict, rec.Code, "a change without the version it read is refused: %s", rec.Body.String())
	update["expected_version"] = created.Version
	rec = f.send(t, admin, http.MethodPut, path, update)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	closesAt, _ = f.closingTime(t, f.unnamed)
	assert.Equal(t, "11:30", closesAt, "the school named since closes earlier, too")

	// ADR 0194: a school that left the Träger no longer reads its changes.
	_, err := f.db.ExecContext(testpkg.Ctx(t), `UPDATE platform.schools SET organization_id = ? WHERE id = ?`, f.other, f.unnamed)
	require.NoError(t, err)
	_, ok = f.closingTime(t, f.unnamed)
	assert.False(t, ok, "only the current Träger counts")
	assert.Empty(t, f.schoolList(t, f.unnamed))

	rec = f.send(t, admin, http.MethodDelete, path, nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	_, ok = f.closingTime(t, f.named)
	assert.False(t, ok, "a deleted change gives the regular session end back")
}

// A Träger and a school use independent ID sequences. The school route must
// reject a visible Träger ID even when it happens to name one of its own rows.
func TestSchoolCannotWriteOpeningChangeThroughCollidingTraegerID(t *testing.T) {
	t.Parallel()
	f := newTraegerOpeningFixture(t, testpkg.SetupTestDB(t))

	rec := f.send(t, f.school(f.named, permissions.SchedulesCreate), http.MethodPost, "/api/opening-changes/", schoolShortDay("Schule"))
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	schoolChange := decodeOpeningChangeData[openingChangeBody](t, rec)
	_, err := f.db.ExecContext(testpkg.Ctx(t), `INSERT INTO schedule.traeger_opening_changes
		(id, organization_id, start_date, end_date, opens_at, closes_at, reason, school_ids)
		VALUES (?, ?, '2031-02-07', '2031-02-07', '07:30', '12:00', 'Träger', ?::bigint[])`,
		schoolChange.ID, f.traeger, fmt.Sprintf("{%d}", f.named))
	require.NoError(t, err)

	update := schoolShortDay("Unbefugt")
	update["expected_version"] = schoolChange.Version
	rec = f.send(t, f.school(f.named, permissions.SchedulesUpdate), http.MethodPut, "/api/opening-changes/"+schoolChange.ID, update)
	assert.Equal(t, http.StatusNotFound, rec.Code, "the school cannot update the Träger change through its colliding ID: %s", rec.Body.String())
	rec = f.send(t, f.school(f.named, permissions.SchedulesDelete), http.MethodDelete, "/api/opening-changes/"+schoolChange.ID, nil)
	assert.Equal(t, http.StatusNotFound, rec.Code, "the school cannot delete the Träger change through its colliding ID: %s", rec.Body.String())

	changes := f.schoolList(t, f.named)
	require.Len(t, changes, 2)
	for _, change := range changes {
		if change.Traeger {
			assert.Equal(t, "Träger", change.Reason)
			continue
		}
		assert.Equal(t, "Schule", change.Reason)
	}
}

// The Träger's list reads its changes in one statement, however many there
// are (#8202).
func TestTraegerOpeningChangeListQueryBudgetStaysFlat(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	f := newTraegerOpeningFixture(t, db)
	inner := chi.NewRouter()
	inner.Mount("/opening-changes", traegerOpeningChangeRoutes(db))
	router := testpkg.MountedQueryBudgetRouter("/traeger", inner)
	admin := f.office(f.traeger, identityaccess.TraegerRoleAdministration)
	counter := testpkg.CaptureQueriesForContext(t, db)
	created, small := 0, 0
	for _, n := range []int{3, 8} {
		for created < n {
			day := traegerShortDay(fmt.Sprintf("Tag %d", created), f.named, f.unnamed)
			day["start_date"] = calendar.NewDate(2031, time.February, 2).AddDays(created * 2).String()
			day["end_date"] = day["start_date"]
			rec := f.send(t, admin, http.MethodPost, traegerOpeningChangesPath, day)
			require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
			created++
		}
		counter.Reset()
		request := httptest.NewRequestWithContext(counter.Context(context.Background()), http.MethodGet, "/opening-changes/?from=2031-02-01&to=2031-02-28", nil)
		rec := apiTest.ExecuteWithAuth(t, router, request, admin)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		require.Len(t, decodeOpeningChangeData[[]traegerOpeningChangeBody](t, rec), n)
		require.Zero(t, counter.WriteRows())
		if small == 0 {
			small = counter.Total()
		} else {
			require.Equal(t, small, counter.Total())
		}
		t.Logf("Träger opening changes N%d statements=%d", n, counter.Total())
		querybudgets.AssertQueryBudget(t, "traeger.opening_changes.list", counter.Measurement(counter.Queries()))
	}
}
