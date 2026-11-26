package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	portalCompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
	parentHTTP "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The family start reads every school's facts as set reads (#8087): its
// statement count grows with the schools, not with the children of a school.
// Positive data drives every read: attendance, a sick day, a day exception, a
// weekly plan, a pickup, open requests, a named share and Familienschutz. Each
// card equals the child's own features and day routes.
func TestParentFamilyStartPositiveGrowthQueryBudget(t *testing.T) {
	t.Parallel()
	now := func() time.Time { return time.Date(2026, 8, 31, 10, 0, 0, 0, time.UTC) } // Monday, 12:00 in Berlin
	today := calendar.NewDate(2026, 8, 31)
	db := testpkg.SetupIsolatedTestDB(t)
	database := testpkg.NewDatabase(t, db)
	router := familyStartGrowthRouter(t, db, database, now)
	ctx := testpkg.Ctx(t)

	chain := testpkg.CreateTestParentGuardianChain(t, db)
	token := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(chain.AccountID), Sub: fmt.Sprint(chain.AccountID), Roles: []string{"parent"}, Scope: "parent"})
	staff, _ := testpkg.CreateTestStaffWithAccount(t, db, "Care", "Family")

	// School B stays the same while school A grows.
	otherSchool, _ := testpkg.CreateTestTenant(t, db)
	testpkg.EnsureAccountTenant(t, db, chain.AccountID, otherSchool)
	otherProfile := testpkg.CreateTestGuardianProfileForTenant(t, db, otherSchool, "Parent", "OtherSchool", "portal")
	_, err := db.ExecContext(ctx, "UPDATE users.guardian_profiles SET account_id=?,has_account=true WHERE id=?", chain.AccountID, otherProfile.ID)
	require.NoError(t, err)
	otherChild := testpkg.CreateTestStudentForTenant(t, db, otherSchool, "Other", "Child", "2a")
	testpkg.CreateTestStudentGuardianLinkForTenant(t, db, otherSchool, otherChild.ID, otherProfile.ID, "primary_guardian")
	testpkg.CreateTestAttendanceForTenant(t, db, otherSchool, otherChild.ID, 0, testpkg.CreateTestDeviceForTenant(t, db, otherSchool, "family-start-b").ID, today, now().Add(-2*time.Hour), nil)

	seed := familyStartSeed{t: t, db: db, ctx: ctx, today: today, now: now(), accountID: chain.AccountID, staffID: staff.ID, deviceID: testpkg.CreateTestDevice(t, db, "family-start-a").ID}
	seed.firstChild(chain.StudentID)
	children := []int64{chain.StudentID}

	counter := testpkg.CaptureQueriesForContext(t, db)
	counter.Stop()
	statements := map[int]int{}
	for _, n := range []int{1, 3} {
		for len(children) < n {
			student := testpkg.CreateTestStudent(t, db, fmt.Sprintf("Sibling%02d", len(children)), "Family", "2b")
			link := testpkg.CreateTestStudentGuardianLink(t, db, student.ID, chain.GuardianProfileID, "primary_guardian")
			if len(children) == 1 {
				seed.sharedRequestChild(student.ID, link.ID)
			} else {
				seed.protectedChild(student.ID, link.ID)
			}
			children = append(children, student.ID)
		}

		req := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/parent/me/family-start", nil, testutil.WithJWTBearer(token))
		// A parent request carries no school: the flow opens each school's
		// transaction itself.
		req = req.WithContext(counter.Context(context.Background()))
		counter.Reset()
		counter.Start()
		rr := testutil.ExecuteRequest(router, req)
		counter.Stop()
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		statements[n] = counter.Total()
		t.Logf("MEASURE parent.me.family_start N%d=%d", n, counter.Total())
		querybudgets.AssertQueryBudget(t, "parent.me.family_start.http_positive_growth", counter.Measurement(counter.Queries()))
		assert.Empty(t, counter.Operation("INSERT"))
		assert.Empty(t, counter.Operation("UPDATE"))
		assert.Empty(t, counter.Operation("DELETE"))

		var envelope struct {
			Data parentHTTP.FamilyStartResponse
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
		cards := map[int64]parentHTTP.FamilyStartCardResponse{}
		for _, card := range envelope.Data.Cards {
			var id int64
			_, err := fmt.Sscan(card.Child.StudentID.String(), &id)
			require.NoError(t, err)
			cards[id] = card
		}
		require.Len(t, cards, n+1, "every child of both schools, no foreign child")
		for _, id := range append([]int64{otherChild.ID}, children...) {
			card, ok := cards[id]
			require.True(t, ok, "card of child %d", id)
			require.NotNil(t, card.Features, "child %d", id)
			require.NotNil(t, card.Today, "child %d", id)
			assert.Equal(t, familyStartSingle[parentHTTP.ChildFeaturesResponse](t, router, token, fmt.Sprintf("/parent/me/children/%d/features", id)), *card.Features, "features of child %d", id)
			assert.Equal(t, familyStartSingle[parentHTTP.TodayStatusResponse](t, router, token, fmt.Sprintf("/parent/me/children/%d/today", id)), *card.Today, "day of child %d", id)
		}
		first := cards[chain.StudentID]
		assert.True(t, first.Features.HasOpenChangeRequest, "own Stammdaten request")
		assert.True(t, first.Features.PickupChangeCareDayEnded, "the changed closing time ends the care day of school A")
		assert.False(t, cards[otherChild.ID].Features.PickupChangeCareDayEnded, "school B keeps its session end")
		assert.Equal(t, "15:30", first.Today.PickupTime, "pickup of the child in care")
		if n == 3 {
			shared, protected := cards[children[1]], cards[children[2]]
			assert.True(t, shared.Features.HasOpenChangeRequest, "a request shared by name")
			assert.False(t, protected.Features.HasOpenChangeRequest, "Familienschutz voids the earlier share")
			assert.True(t, shared.Features.NotesEnabled, "the sibling's own notes right")
			assert.False(t, protected.Features.NotesEnabled, "no notes right on this relationship")
			assert.NotEqual(t, protected.Today.State, shared.Today.State, "each child keeps its own day")
		}
	}
	require.Equal(t, statements[1], statements[3], "the statement count does not grow with the children of a school")
}

// familyStartSingle reads one child's own route, the contract the card must
// equal.
func familyStartSingle[T any](t *testing.T, router chi.Router, token, path string) T {
	t.Helper()
	rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil, testutil.WithJWTBearer(token)))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var envelope struct{ Data T }
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
	return envelope.Data
}

type familyStartSeed struct {
	t         *testing.T
	db        *bun.DB
	ctx       context.Context
	today     calendar.Date
	now       time.Time
	accountID int64
	staffID   int64
	deviceID  int64
}

// firstChild is in care and checked in, without a plan or exception for the
// day: its pickup decides the care day. It has its own Stammdaten request.
func (s familyStartSeed) firstChild(studentID int64) {
	testpkg.CreateTestPickupSchedule(s.t, s.db, studentID, int(time.Monday), s.staffID, "15:30")
	testpkg.CreateTestAttendanceForDate(s.t, s.db, studentID, 0, s.deviceID, s.today, s.now.Add(-2*time.Hour), nil)
	s.exec(`INSERT INTO users.student_data_change_requests (tenant_id,student_id,submitted_by,target,field_key,new_value,status) VALUES (?,?,?,'person','first_name','"Pending"'::jsonb,'pending')`, testpkg.Tenant(s.t), studentID, s.accountID)
	// The school closes at 11:00 today (#8173): its care day is over at noon.
	s.exec(`INSERT INTO schedule.opening_changes (tenant_id,start_date,end_date,opens_at,closes_at,reason) VALUES (?,?,?,'07:30','11:00','Zeugnisausgabe')`, testpkg.Tenant(s.t), s.today, s.today)
}

// sharedRequestChild is sick today, has a day exception and an open weekly
// plan request a co-guardian shared with the account by name.
func (s familyStartSeed) sharedRequestChild(studentID, linkID int64) {
	require.NoError(s.t, testpkg.SetTestStudentGuardianPermissions(s.ctx, s.db, linkID, map[string]interface{}{
		"parent_portal.access": true, "parent_portal.notes.write": true, "parent_portal.request.submit": true,
	}))
	testpkg.CreateTestStudentStatusDay(s.t, s.db, studentID, s.today, "sick")
	testpkg.CreateTestArrivalException(s.t, s.db, studentID, s.today, s.staffID, "09:00", "Arzttermin")
	author := testpkg.CreateTestCoGuardianForStudent(s.t, s.db, studentID, "Shared", "Author")
	requestID := s.weeklyRequest(studentID, author.AccountID)
	s.share(studentID, requestID, author.AccountID)
}

// protectedChild has a weekly plan, left the OGS today and has a request a
// co-guardian shared before Familienschutz was switched on.
func (s familyStartSeed) protectedChild(studentID, linkID int64) {
	require.NoError(s.t, testpkg.SetTestStudentGuardianPermissions(s.ctx, s.db, linkID, map[string]interface{}{"parent_portal.access": true}))
	testpkg.CreateTestArrivalSchedule(s.t, s.db, studentID, int(time.Monday), s.staffID, "08:00")
	left := s.now.Add(-30 * time.Minute)
	testpkg.CreateTestAttendanceForDate(s.t, s.db, studentID, 0, s.deviceID, s.today, s.now.Add(-3*time.Hour), &left)
	author := testpkg.CreateTestCoGuardianForStudent(s.t, s.db, studentID, "Protected", "Author")
	requestID := s.weeklyRequest(studentID, author.AccountID)
	s.share(studentID, requestID, author.AccountID)
	s.exec(`INSERT INTO users.student_family_protection_events (tenant_id,student_id,enabled,reason,actor_account_id) VALUES (?,?,true,'Schutz',?)`, testpkg.Tenant(s.t), studentID, author.AccountID)
}

func (s familyStartSeed) weeklyRequest(studentID, authorID int64) int64 {
	var id int64
	require.NoError(s.t, s.db.NewRaw(`INSERT INTO schedule.care_schedule_change_requests (tenant_id,student_id,submitted_by,request_kind,payload,status) VALUES (?,?,?,'weekly_schedule',?::jsonb,'pending') RETURNING id`,
		testpkg.Tenant(s.t), studentID, authorID, `{"weekdays":[{"weekday":1,"pickup":"15:30"}]}`).Scan(s.ctx, &id))
	return id
}

func (s familyStartSeed) share(studentID, requestID, authorID int64) {
	s.exec(`INSERT INTO users.parent_request_share_events (tenant_id,student_id,request_type,request_id,author_account_id,recipient_account_ids) VALUES (?,?,'care_schedule',?,?,ARRAY[?]::BIGINT[])`,
		testpkg.Tenant(s.t), studentID, requestID, authorID, s.accountID)
}

func (s familyStartSeed) exec(query string, args ...any) {
	_, err := s.db.ExecContext(s.ctx, query, args...)
	require.NoError(s.t, err)
}

// familyStartGrowthRouter mounts the parent resource over the owners the
// root binds for the start cards: Care Plan's plans, pickups, status days and
// requests, Student Presence's attendance, the sharing ledger, real settings
// and the meal plan.
func familyStartGrowthRouter(t *testing.T, db *bun.DB, database transactionruntime.Database, now func() time.Time) chi.Router {
	t.Helper()
	members := owners.MustNewMembershipTestRepositories(database)
	repos, err := NewParentRouteTestRepositories(database, members)
	require.NoError(t, err)
	people := NewPeopleRepositorySuiteFactory(database)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	sharing, err := NewStudentPeopleRows(database, members)
	require.NoError(t, err)
	feedback, err := NewFeedbackTestModule(database, testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	module, _, _, _, _, _, err := NewStudentTestModule(database, testpkg.TenantRuntime(t, db), feedback.Feedback, now)
	require.NoError(t, err)
	_, schedules, _, _, _, _, err := NewTestCareRequests(database, slog.Default(), now)
	require.NoError(t, err)
	presence, err := presenceCompose.New(presenceCompose.Dependencies{DB: db, Observe: func(presenceCompose.Observation) {}})
	require.NoError(t, err)
	directory := owners.MustNewPeopleDirectory(database)
	mealSettings, err := owners.BuildMealPlanSettings(settings.Settings)
	require.NoError(t, err)
	schoolCalendar, err := owners.BuildSchoolCalendarRecords(database, func(schoolCalendarCompose.Observation) {}, settings.Settings, nil)
	require.NoError(t, err)
	meals, err := owners.BuildServeMealPlan(database, mealSettings, owners.NewStudentRootReads(people.Student), directory, schoolCalendar, nil)
	require.NoError(t, err)
	portal := portalCompose.New(portalCompose.Dependencies{
		GuardianChanges: owners.ParentGuardianChanges(), DeparturePolicy: owners.ParentDeparturePolicy(), GuardianPolicy: owners.NewParentGuardianPolicy(), Fingerprints: owners.SecurityFingerprints{}, Declarations: owners.ParentDeclarationPolicy(), Locales: owners.ParentPortalLocales(), Runtime: owners.ParentPortalRuntime{}, Logger: slog.Default(), Now: now,
		ChildRepo: repos.ParentChildReads(), StudentRepo: owners.NewParentStudentReads(people.Student), PersonRepo: owners.NewParentPersonReads(people.Person), GuardianProfileRepo: owners.NewParentGuardianProfileReads(people.GuardianProfile), StudentGuardianRepo: owners.NewParentStudentGuardianReads(people.StudentGuardian),
		Memberships: owners.NewParentSchoolMembershipLock(database), Settings: owners.BindParentSettings(settings.Settings), MealPlan: meals.Capability,
		CareRequests: module.CareRequests, ChangeRequestRepo: owners.NewParentDataRequestReads(repos.CareExceptions), StatusDayRepo: repos.StudentStatusDay,
		ArrivalSchedules: owners.NewParentArrivalSchedules(schedules.Arrivals), PickupSchedules: owners.NewParentPickupSchedules(schedules.Pickups),
		Attendance:             owners.BindParentAttendance(presence),
		FamilyProtectionEvents: owners.BindParentFamilyProtectionReads(sharing.FamilyProtection), ParentRequestShares: owners.BindParentRequestShareRecords(sharing.ParentRequestShare), ParentRequestEvents: owners.NewParentRequestEvents(sharing.ParentRequestEvent),
		CarePlanPolicy: owners.NewParentCarePlanPolicy(), ClosingTimes: OpeningChangeClosingTimes(),
	})
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Use(RequestSettingsCacheMiddleware, RequestIdentityCacheMiddleware)
	router.Mount("/parent", parentHTTP.NewResource(parentHTTP.ResourceConfig{Now: now, Parent: portal}).Router(ParentSessionChain))
	return router
}
