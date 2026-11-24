package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The tests below exercise the composed /staff router (#2667): membership
// routes from the School Membership adapter and workforce routes from the
// time-tracking admin resource share one protected group. Each assertion
// spans both halves, which is why they live with the composition root.

// staffCompositionContext keeps the composed router plus fixture closures;
// the closures capture the database so the test names no persistence type.
type staffCompositionContext struct {
	router chi.Router
	// createStaff creates a staff member and returns (staffID, personID).
	createStaff func(firstName, lastName string) (int64, int64)
	// createStaffWithAccount creates a staff member linked to an account and
	// returns (staffID, accountID).
	createStaffWithAccount func(firstName, lastName string) (int64, int64)
	assignLehrkraft        func(accountID int64)
	// createForeignStaffWithAccount is createStaffWithAccount in a second
	// school the test's caller does not belong to.
	createForeignStaffWithAccount func(firstName, lastName string) (int64, int64)
	// setAccountAvatar stores urlPath as the account's profile picture.
	setAccountAvatar func(accountID int64, urlPath string)
	// absentToday records an approved absence of a school-defined type with
	// the given wording for the staff member on the current day.
	absentToday func(staffID int64, wording string)
	// createAccountExternal records an external caregiver record for a staff member with a
	// moto account. It returns the staff ID.
	createAccountExternal func(firstName, lastName string) int64
	// retire marks a staff membership as left on the given day, the state
	// the staff offboarding leaves behind.
	retire func(staffID int64, leftAt time.Time)
	// countQueries counts the statements of requests marked with the
	// returned counter's Context; parallel tests share the database.
	countQueries func() *testpkg.QueryCounter
}

func setupStaffCompositionRoute(t *testing.T) *staffCompositionContext {
	t.Helper()
	return setupStaffCompositionRouteAt(t, time.Now)
}

// setupStaffCompositionRouteAt composes the router with the staff
// offboarding and its planned exits on the clock now.
func setupStaffCompositionRouteAt(t *testing.T, now func() time.Time) *staffCompositionContext {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	svc, work, err := NewStaffTestModuleWithClock(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), now)
	require.NoError(t, err)
	membership, err := owners.NewSchoolMembership(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	identity, err := NewAuthTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	resource := newStaffTestResource(membership, svc, work, identity.Auth, "", testpkg.NewDatabase(t, db), slog.Default())

	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/staff", resource.Router())
	return &staffCompositionContext{
		router: router,
		createStaff: func(firstName, lastName string) (int64, int64) {
			staff := testpkg.CreateTestStaff(t, db, firstName, lastName)
			return staff.ID, staff.PersonID
		},
		createStaffWithAccount: func(firstName, lastName string) (int64, int64) {
			staff, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, testpkg.Tenant(t), firstName, lastName)
			return staff.ID, account.ID
		},
		createForeignStaffWithAccount: func(firstName, lastName string) (int64, int64) {
			foreignTenantID, _ := testpkg.CreateTestTenant(t, db)
			staff, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, foreignTenantID, firstName, lastName)
			return staff.ID, account.ID
		},
		setAccountAvatar: func(accountID int64, urlPath string) {
			_, err := db.NewRaw(`UPDATE auth.accounts SET avatar = ? WHERE id = ?`, urlPath, accountID).
				Exec(context.Background())
			require.NoError(t, err)
		},
		assignLehrkraft: func(accountID int64) {
			testpkg.AssignLehrkraftSystemRole(t, db, accountID, testpkg.Tenant(t))
		},
		absentToday: func(staffID int64, wording string) {
			absenceType := testpkg.CreateTestStaffAbsenceType(t, db, wording)
			testpkg.CreateTestStaffAbsenceToday(t, db, staffID, absenceType.ID)
		},
		createAccountExternal: func(firstName, lastName string) int64 {
			staff, _ := testpkg.CreateTestStaffWithAccount(t, db, firstName, lastName)
			_, err := db.NewRaw(`INSERT INTO users.external_caregivers (tenant_id, staff_id, activity_expertise) VALUES (?, ?, ?)`,
				testpkg.Tenant(t), staff.ID, "Musik").Exec(context.Background())
			require.NoError(t, err)
			return staff.ID
		},
		retire: func(staffID int64, leftAt time.Time) {
			_, err := db.NewRaw(`UPDATE users.staff_school_memberships SET deleted_at = ? WHERE id = ?`, leftAt, staffID).
				Exec(context.Background())
			require.NoError(t, err)
		},
		countQueries: func() *testpkg.QueryCounter { return testpkg.CaptureQueriesForContext(t, db) },
	}
}

// staffRecordVersion reads the version of the staff record form, as the
// Konto tab does before it saves (ADR 0311).
func staffRecordVersion(t *testing.T, router chi.Router, staffID int64) string {
	t.Helper()
	rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d", staffID), nil,
		testutil.WithJWTBearer(staffCompositionToken(t, "staff:manage"))))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var envelope struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
	require.NotEmpty(t, envelope.Data.Version, "a staff:manage read answers the record's version")
	return envelope.Data.Version
}

func staffCompositionToken(t *testing.T, perms ...string) string {
	t.Helper()
	claims := testutil.DefaultTestClaims()
	claims.Permissions = perms
	return testutil.MintTestJWT(t, claims)
}

// betreuerPermissions is the effective permission set of the unmodified
// `user` (Betreuer) system role for the staff surfaces: it may read the
// directory and write child data, and that is all (#2906).
var betreuerPermissions = []string{
	"users:read", "users:list", "users:create", "users:update", "users:absence",
	"groups:read", "visits:read", "time_tracking:own",
}

// TestBetreuerRoleCannotReachColleaguePersonnelData pins acceptance criteria
// 1-3 of #2906 across both halves of the composed router.
func TestBetreuerRoleCannotReachColleaguePersonnelData(t *testing.T) {
	t.Parallel()

	ctx := setupStaffCompositionRoute(t)
	colleagueID, colleaguePersonID := ctx.createStaff("Kollegin", "Personalakte")
	token := staffCompositionToken(t, betreuerPermissions...)

	forbiddenReads := []string{
		fmt.Sprintf("/staff/%d/stammdaten", colleagueID),
		fmt.Sprintf("/staff/%d/documents", colleagueID),
		fmt.Sprintf("/staff/documents-profile/%d", colleagueID),
		"/staff/documents-directory",
		fmt.Sprintf("/staff/%d/stammdaten/bank-steuer", colleagueID),
	}
	for _, path := range forbiddenReads {
		req := testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, testutil.WithJWTBearer(token))
		rr := testutil.ExecuteRequest(ctx.router, req)
		assert.Equal(t, http.StatusForbidden, rr.Code, "GET %s must be refused: %s", path, rr.Body.String())
	}

	forbiddenWrites := []struct {
		method string
		path   string
		body   map[string]interface{}
	}{
		{http.MethodPut, fmt.Sprintf("/staff/%d", colleagueID),
			map[string]interface{}{"person_id": fmt.Sprint(colleaguePersonID), "staff_notes": "Fremde Notiz"}},
		{http.MethodPut, fmt.Sprintf("/staff/%d/stammdaten/person", colleagueID),
			map[string]interface{}{"first_name": "Neu", "last_name": "Name"}},
		{http.MethodPut, fmt.Sprintf("/staff/%d/stammdaten/kontakt", colleagueID),
			map[string]interface{}{"phone": "+49 170 1"}},
		{http.MethodPut, fmt.Sprintf("/staff/%d/stammdaten/arbeitsvertrag", colleagueID),
			map[string]interface{}{"weekly_hours": 20}},
		{http.MethodPut, fmt.Sprintf("/staff/%d/stammdaten/qualifikationen", colleagueID),
			map[string]interface{}{"qualifikationen": []any{}}},
		{http.MethodPut, fmt.Sprintf("/staff/%d/vacation/quota", colleagueID),
			map[string]interface{}{"year": 2026, "days": 30}},
	}
	for _, tc := range forbiddenWrites {
		req := testutil.NewAuthenticatedRequest(t, tc.method, tc.path, tc.body, testutil.WithJWTBearer(token))
		rr := testutil.ExecuteRequest(ctx.router, req)
		assert.Equal(t, http.StatusForbidden, rr.Code, "%s %s must be refused: %s", tc.method, tc.path, rr.Body.String())
	}
}

// TestBetreuerRoleSeesOnlyTheMinimalColleagueView pins acceptance criterion
// 4 of #2906: the directory a Betreuer may read carries names, work e-mail,
// account role and today's presence, never notes, employment type, absence
// reason or NFC tag. The fixture here sets only the notes; the other fields
// are pinned with set values on the list by
// TestListStaffRedactsForTheDirectoryTier in modules/schoolmembership/http,
// whose field access the single read shares.
func TestBetreuerRoleSeesOnlyTheMinimalColleagueView(t *testing.T) {
	t.Parallel()

	ctx := setupStaffCompositionRoute(t)
	colleagueID, colleaguePersonID := ctx.createStaff("Sichtbare", "Kollegin")

	body := map[string]interface{}{
		"person_id":        fmt.Sprint(colleaguePersonID),
		"staff_notes":      "Geheime Personalnotiz",
		"expected_version": staffRecordVersion(t, ctx.router, colleagueID),
	}
	req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/staff/%d", colleagueID), body,
		testutil.WithJWTBearer(staffCompositionToken(t, "staff:manage")))
	testutil.AssertSuccessResponse(t, testutil.ExecuteRequest(ctx.router, req), http.StatusOK)

	betreuer := testutil.WithJWTBearer(staffCompositionToken(t, betreuerPermissions...))
	for _, path := range []string{"/staff", fmt.Sprintf("/staff/%d", colleagueID)} {
		rr := testutil.ExecuteRequest(ctx.router,
			testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, betreuer))
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assert.NotContains(t, rr.Body.String(), "Geheime Personalnotiz",
			"%s must not carry staff notes for the Betreuer tier", path)
		assert.NotContains(t, rr.Body.String(), `"staff_notes"`, path)
	}

	rr := testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodGet,
		fmt.Sprintf("/staff/%d", colleagueID), nil, testutil.WithJWTBearer(staffCompositionToken(t, "staff:manage", "users:read"))))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), "Geheime Personalnotiz")

	rr = testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodGet,
		fmt.Sprintf("/staff/%d", colleagueID), nil, testutil.WithJWTBearer(staffCompositionToken(t, "staff:stammdaten"))))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.NotContains(t, rr.Body.String(), "Geheime Personalnotiz",
		"staff:stammdaten maintains the personnel file, not the private staff notes")
}

// TestPersonnelPermissionsReachTheStaffDirectory pins that the two personnel
// permissions of #2906 open the staff list and the profile on their own.
func TestPersonnelPermissionsReachTheStaffDirectory(t *testing.T) {
	t.Parallel()

	ctx := setupStaffCompositionRoute(t)
	colleagueID, _ := ctx.createStaff("Erreichbare", "Kollegin")

	for _, permission := range []string{"staff:stammdaten", "staff:manage"} {
		auth := testutil.WithJWTBearer(staffCompositionToken(t, permission))
		for _, path := range []string{"/staff", fmt.Sprintf("/staff/%d", colleagueID)} {
			rr := testutil.ExecuteRequest(ctx.router,
				testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, auth))
			assert.Equal(t, http.StatusOK, rr.Code,
				"GET %s must be reachable with %s: %s", path, permission, rr.Body.String())
		}
	}
}

func TestStaffPersonConflictIsHTTPConflict(t *testing.T) {
	t.Parallel()

	ctx := setupStaffCompositionRoute(t)
	staffID, _ := ctx.createStaff("Bestehende", "Zuordnung")
	_, conflictingPersonID := ctx.createStaff("Doppelte", "Zuordnung")

	req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/staff/%d", staffID),
		map[string]interface{}{"person_id": fmt.Sprint(conflictingPersonID), "expected_version": staffRecordVersion(t, ctx.router, staffID)},
		testutil.WithJWTBearer(staffCompositionToken(t, "staff:manage", "users:manage")))
	rr := testutil.ExecuteRequest(ctx.router, req)

	assert.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	assert.NotContains(t, rr.Body.String(), "general.changed_since_read", "the conflict is the person, not the read")
}

// TestStaffRecordUpdateRefusesAStaleRead pins ADR 0311 on PUT /staff/{id}:
// the Konto tab sends the record's version of its read; notes or a profile
// saved meanwhile refuse the save with general.changed_since_read and keep
// what was stored, an empty version too. The save answers the new version,
// so a second save from the same form succeeds.
func TestStaffRecordUpdateRefusesAStaleRead(t *testing.T) {
	t.Parallel()

	ctx := setupStaffCompositionRoute(t)
	staffID, personID := ctx.createStaff("Gelesene", "Akte")
	manage := testutil.WithJWTBearer(staffCompositionToken(t, "staff:manage"))
	put := func(notes, version string) *httptest.ResponseRecorder {
		t.Helper()
		return testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/staff/%d", staffID),
			map[string]interface{}{"person_id": fmt.Sprint(personID), "staff_notes": notes, "expected_version": version}, manage))
	}
	notes := func() string {
		t.Helper()
		rr := testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d", staffID), nil, manage))
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		var envelope struct {
			Data struct {
				StaffNotes string `json:"staff_notes"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
		return envelope.Data.StaffNotes
	}

	shown := staffRecordVersion(t, ctx.router, staffID)
	saved := put("Notiz der Kollegin", staffRecordVersion(t, ctx.router, staffID))
	require.Equal(t, http.StatusOK, saved.Code, saved.Body.String())

	for name, version := range map[string]string{"stale": shown, "empty": ""} {
		refused := put("Ältere Notiz", version)
		require.Equal(t, http.StatusConflict, refused.Code, "%s: %s", name, refused.Body.String())
		assert.Contains(t, refused.Body.String(), "general.changed_since_read", name)
	}
	assert.Equal(t, "Notiz der Kollegin", notes(), "the refused saves wrote nothing")

	var answer struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(saved.Body.Bytes(), &answer))
	again := put("Zweite Notiz", answer.Data.Version)
	require.Equal(t, http.StatusOK, again.Code, "the save's answered version carries a second save: %s", again.Body.String())
	assert.Equal(t, "Zweite Notiz", notes())
}

// TestBetreuerRoleDoesNotSeeTheSchoolsAbsenceWording pins that the school's
// own Abwesenheitsart wording (#2403) follows the personnel gate on both
// staff read paths (#2906).
func TestBetreuerRoleDoesNotSeeTheSchoolsAbsenceWording(t *testing.T) {
	t.Parallel()

	ctx := setupStaffCompositionRoute(t)
	colleagueID, _ := ctx.createStaff("Abwesende", "Kollegin")
	ctx.absentToday(colleagueID, "Regenerationstag")

	betreuer := testutil.WithJWTBearer(staffCompositionToken(t, betreuerPermissions...))
	for _, path := range []string{"/staff", fmt.Sprintf("/staff/%d", colleagueID)} {
		rr := testutil.ExecuteRequest(ctx.router,
			testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, betreuer))
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assert.NotContains(t, rr.Body.String(), "Regenerationstag",
			"%s must not carry the school's absence wording for the Betreuer tier", path)
		assert.NotContains(t, rr.Body.String(), `"absence_type_label"`, path)
	}

	personnel := testutil.WithJWTBearer(staffCompositionToken(t, "users:read", "staff:stammdaten"))
	for _, path := range []string{"/staff", fmt.Sprintf("/staff/%d", colleagueID)} {
		rr := testutil.ExecuteRequest(ctx.router,
			testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, personnel))
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		assert.Contains(t, rr.Body.String(), "Regenerationstag", path)
	}
}

// TestStaffAvatarStaysInsideTheSchool pins #4432: a colleague's profile
// picture reaches callers of the same school and no other. The account and
// its picture are global, so only the school-scoped staff lookup keeps a
// foreign school from reading it.
func TestStaffAvatarStaysInsideTheSchool(t *testing.T) {
	t.Parallel()

	ctx := setupStaffCompositionRoute(t)
	ownStaffID, ownAccountID := ctx.createStaffWithAccount("Eigene", "Kollegin")
	foreignStaffID, foreignAccountID := ctx.createForeignStaffWithAccount("Fremde", "Kollegin")

	publicDir, err := nativeUploads.ResolvePublicDir()
	require.NoError(t, err)
	urlPath := fmt.Sprintf("/uploads/avatars/staff-avatar-%d.png", ownAccountID)
	filePath := filepath.Join(publicDir, filepath.FromSlash(urlPath))
	picture := []byte("\x89PNG\r\n\x1a\nstaff-avatar")
	require.NoError(t, os.WriteFile(filePath, picture, 0o600))
	t.Cleanup(func() { _ = os.Remove(filePath) })
	ctx.setAccountAvatar(ownAccountID, urlPath)
	ctx.setAccountAvatar(foreignAccountID, urlPath)

	betreuer := testutil.WithJWTBearer(staffCompositionToken(t, betreuerPermissions...))

	counter := ctx.countQueries()
	request := testutil.NewAuthenticatedRequest(t, http.MethodGet,
		fmt.Sprintf("/staff/%d/avatar", ownStaffID), nil, betreuer)
	own := testutil.ExecuteRequest(ctx.router, request.WithContext(counter.Context(request.Context())))
	t.Logf("P3 staff avatar: %d statements", len(counter.Queries()))
	require.Empty(t, counter.Selects("staff_employment_profiles"))
	require.Len(t, counter.Selects("auth.accounts"), 1, "only the current avatar, not account metadata")
	require.Equal(t, http.StatusOK, own.Code, own.Body.String())
	assert.Equal(t, picture, own.Body.Bytes())

	foreign := testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodGet,
		fmt.Sprintf("/staff/%d/avatar", foreignStaffID), nil, betreuer))
	assert.Equal(t, http.StatusNotFound, foreign.Code, foreign.Body.String())
	assert.NotContains(t, foreign.Body.String(), "staff-avatar")
}

// A planned exit (#4809) takes the deletion's permission, refuses a day in
// the past with its own code and shows its state to a caller who may change it.
func TestPlannedExitRoutesFollowTheDeletionPermission(t *testing.T) {
	t.Parallel()

	ctx := setupStaffCompositionRoute(t)
	subjectID, _ := ctx.createStaff("Gehende", "Kollegin")
	_, leadAccountID := ctx.createStaffWithAccount("Planende", "Leitung")
	claims := testutil.DefaultTestClaims()
	claims.ID = int(leadAccountID)
	claims.Permissions = []string{"users:delete", "users:read"}
	lead := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
	path := fmt.Sprintf("/staff/%d/planned-exit", subjectID)
	day := time.Now().AddDate(0, 1, 0).Format("2006-01-02")

	rr := testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, path,
		map[string]any{"last_working_day": day}, testutil.WithJWTBearer(staffCompositionToken(t, betreuerPermissions...))))
	assert.Equal(t, http.StatusForbidden, rr.Code, rr.Body.String())

	rr = testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, path,
		map[string]any{"last_working_day": "2020-01-01"}, lead))
	assert.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"staff.exit_day_in_past"`)

	rr = testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, path,
		map[string]any{"last_working_day": day}, lead))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	rr = testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d", subjectID), nil, lead))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"planned_exit_date":"`+day+`"`)

	rr = testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d", subjectID), nil,
		testutil.WithJWTBearer(staffCompositionToken(t, betreuerPermissions...))))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.NotContains(t, rr.Body.String(), "planned_exit_date", "colleagues see no personnel data")

	rr = testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodDelete, path, nil, lead))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	rr = testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodDelete, path, nil, lead))
	assert.Equal(t, http.StatusNotFound, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"staff.exit_not_planned"`)
}

// A planned exit is checked against the root's day, not the real one
// (#7104): with the clock years ahead, a day the real calendar has not
// reached yet is already past.
func TestPlannedExitRefusesADayBeforeTheRootsDay(t *testing.T) {
	t.Parallel()

	pinned := time.Date(2040, time.March, 14, 12, 0, 0, 0, calendar.Berlin)
	ctx := setupStaffCompositionRouteAt(t, func() time.Time { return pinned })
	subjectID, _ := ctx.createStaff("Gehende", "Kollegin")
	_, leadAccountID := ctx.createStaffWithAccount("Planende", "Leitung")
	claims := testutil.DefaultTestClaims()
	claims.ID = int(leadAccountID)
	claims.Permissions = []string{"users:delete", "users:read"}
	lead := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
	path := fmt.Sprintf("/staff/%d/planned-exit", subjectID)

	rr := testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, path,
		map[string]any{"last_working_day": "2039-12-01"}, lead))
	assert.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"staff.exit_day_in_past"`)

	rr = testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, path,
		map[string]any{"last_working_day": "2040-04-01"}, lead))
	assert.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
}
