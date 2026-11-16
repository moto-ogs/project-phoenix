package contracttest_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/careplan"
	careplanCompose "github.com/moto-ogs/project-phoenix/modules/careplan/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	arrivalTimetable "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The notices about a changed Stundenplan of a class (#7142) are tested from
// the outside: a change is saved through Care Plan's arrival schedules inside
// a tenant transaction, as the request runs it, Delivery writes the feed and
// the push outbox in it, and each account reads its own feed through the
// staff and parents portal routes.

// classFeedToday is the pinned school day: a Monday.
const classFeedToday calendar.Date = "2030-06-10"

// classFeedClass is the class of CreateTestParentGuardianChain's child.
const classFeedClass = "1a"

type classFeedFixture struct {
	db      *bun.DB
	service careplan.ArrivalScheduleService
	router  chi.Router
	consent func(accountID int64, notificationType string, enabled bool)
}

type classFeedPerson struct {
	staffID   int64
	accountID int64
}

func newClassFeedFixture(t *testing.T) *classFeedFixture {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	database := testpkg.NewDatabase(t, db)
	unit := testpkg.TenantRuntime(t, db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, unit)
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, unit, settings.Settings, module)
	require.NoError(t, err)
	// Equal bounds open the push window all day, so the test does not depend
	// on the wall clock it runs at.
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "notifications.active_window_start", `"06:00"`)
	testpkg.SetTestTenantSetting(t, db, testpkg.Tenant(t), "notifications.active_window_end", `"06:00"`)

	members := owners.MustNewMembershipTestRepositories(database)
	notices := owners.NewCarePlanClassTimetableNotices(
		owners.DeliveryNotifications{Notifier: notifier, Preferences: module.NotificationPreferences},
		owners.ClassTimetableNoticeSources{
			Actor: testpkg.RequestAuditActor, Audience: owners.NewParentGroupAudience(database), Students: members.Student, Staff: members.Staff,
			Membership: owners.MustNewSchoolMembership(database),
		})
	require.NotNil(t, notices)

	today := func() calendar.Date { return classFeedToday }
	arrivals, err := arrivalTimetable.NewClassArrivals(db, func(arrivalTimetable.Observation) {})
	require.NoError(t, err)
	people := owners.MustNewPeopleDirectory(database)
	exceptions, err := owners.NewClassArrivalExceptions(arrivals, people, today)
	require.NoError(t, err)
	rules, deps, err := owners.ArrivalScheduleBinding(people, owners.ClassArrivalPlans(arrivals), exceptions, nil)
	require.NoError(t, err)
	deps.Today, deps.Notices = today, notices
	service, err := careplanCompose.NewArrivalSchedules(db, api.NewRepositoryTestFactory(database).CarePlan(), nil, rules, deps)
	require.NoError(t, err)

	consent := api.NewNotificationConsentTestStore(database)
	return &classFeedFixture{
		db: db, service: service, router: module.NotificationPreferenceRouterForTests(),
		consent: func(accountID int64, notificationType string, enabled bool) {
			require.NoError(t, testpkg.TenantCommand3(t, testpkg.Ctx(t), db, consent.RecordConsent, accountID, notificationType, enabled))
		},
	}
}

// staff is a staff member with an account in the school and one staff-portal
// device.
func (f *classFeedFixture) staff(t *testing.T, name string) classFeedPerson {
	t.Helper()
	staff, account := testpkg.CreateTestStaffWithAccount(t, f.db, name, "Klasse")
	testpkg.MapAccountToTenant(t, f.db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, f.db, account.ID, testpkg.Tenant(t))
	f.device(t, account.ID, "staff")
	return classFeedPerson{staffID: staff.ID, accountID: account.ID}
}

// groupTeacher leads the OGS group.
func (f *classFeedFixture) groupTeacher(t *testing.T, name string, groupID int64) classFeedPerson {
	t.Helper()
	teacher, account := testpkg.CreateTestTeacherWithAccount(t, f.db, name, "Gruppe")
	testpkg.MapAccountToTenant(t, f.db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, f.db, account.ID, testpkg.Tenant(t))
	testpkg.CreateTestGroupTeacher(t, f.db, groupID, teacher.ID)
	f.device(t, account.ID, "staff")
	return classFeedPerson{staffID: teacher.StaffID, accountID: account.ID}
}

// family is a guardian with portal access to one child of the class, a
// parents-portal device and the push of the type switched on.
func (f *classFeedFixture) family(t *testing.T, class string) testpkg.ParentChain {
	t.Helper()
	chain := testpkg.CreateTestParentGuardianChain(t, f.db)
	_, err := f.db.ExecContext(context.Background(), `UPDATE users.student_school_memberships SET school_class = ? WHERE student_profile_id = ?`, class, chain.StudentID)
	require.NoError(t, err)
	f.device(t, chain.AccountID, "parent")
	f.consent(chain.AccountID, "parent_class_timetable_changed", true)
	return chain
}

func (f *classFeedFixture) device(t *testing.T, accountID int64, portal string) {
	t.Helper()
	_, err := f.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, ?, ?, 'test-p256dh', 'test-auth')`, testpkg.Tenant(t), accountID, portal, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/class-%s-%d", portal, accountID))
	require.NoError(t, err)
}

// as runs a write as the request of the actor does: in a tenant transaction
// with the actor's session.
func (f *classFeedFixture) as(t *testing.T, actor classFeedPerson, write func(context.Context) error) {
	t.Helper()
	ctx := context.WithValue(testpkg.Ctx(t), sessiontoken.CtxClaims, sessiontoken.AppClaims{ID: int(actor.accountID)})
	require.NoError(t, testpkg.TenantCommand0(t, ctx, f.db, write))
}

func (f *classFeedFixture) dayChange(t *testing.T, actor classFeedPerson, day calendar.Date, clock string) {
	t.Helper()
	at, err := time.Parse("15:04", clock)
	require.NoError(t, err)
	f.as(t, actor, func(ctx context.Context) error {
		_, err := f.service.UpsertClassArrivalException(ctx, careplan.ClassArrivalExceptionInput{SchoolClass: classFeedClass, Date: day, ArrivalTime: at, Reason: ptr("Krankheit der Lehrerin")}, actor.staffID)
		return err
	})
}

func (f *classFeedFixture) weekly(t *testing.T, actor classFeedPerson, inputs ...careplan.ArrivalScheduleInput) {
	t.Helper()
	f.as(t, actor, func(ctx context.Context) error {
		_, err := f.service.BulkUpsertArrivalSchedules(ctx, careplan.ArrivalScheduleBulkFilter{SchoolClass: classFeedClass}, inputs, actor.staffID)
		return err
	})
}

type classFeedEntry struct {
	ID       int64   `json:"id"`
	Type     string  `json:"type"`
	Title    string  `json:"title"`
	Body     string  `json:"body"`
	DeepLink string  `json:"deep_link"`
	ReadAt   *string `json:"read_at"`
}

func (f *classFeedFixture) read(t *testing.T, claims sessiontoken.AppClaims, method, path string) []classFeedEntry {
	t.Helper()
	request := testutil.NewAuthenticatedRequest(t, method, path, nil, testutil.WithJWTBearer(testutil.MintTestJWT(t, claims)))
	response := testutil.ExecuteRequestForTest(t, f.router, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var feed struct {
		Data struct {
			Entries []classFeedEntry `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &feed))
	return feed.Data.Entries
}

func (f *classFeedFixture) staffFeed(t *testing.T, person classFeedPerson, tenantID int64) []classFeedEntry {
	t.Helper()
	claims := testutil.TeacherTestClaims(int(person.accountID))
	claims.TenantID = tenantID
	return f.read(t, claims, http.MethodGet, "/api/notifications/feed")
}

func (f *classFeedFixture) familyFeed(t *testing.T, chain testpkg.ParentChain) []classFeedEntry {
	t.Helper()
	return f.read(t, testutil.ParentTestClaims(int(chain.AccountID)), http.MethodGet, "/parent/me/notifications/feed")
}

// pushes returns title and body of the account's pushes of the type.
func (f *classFeedFixture) pushes(t *testing.T, accountID int64, notificationType string) []string {
	t.Helper()
	var texts []string
	require.NoError(t, f.db.NewRaw(`SELECT concat_ws(' | ', payload->>'title', payload->>'body') FROM platform.push_outbox
		WHERE tenant_id = ? AND (recipient->>'account_id')::bigint = ? AND payload->>'type' = ?`,
		testpkg.Tenant(t), accountID, notificationType).Scan(context.Background(), &texts))
	return texts
}

func ptr(value string) *string { return &value }

func TestClassTimetableFeedReachesThePeopleOfTheClassOnly(t *testing.T) {
	t.Parallel()
	f := newClassFeedFixture(t)
	family, otherFamily := f.family(t, classFeedClass), f.family(t, "2b")
	group := testpkg.CreateTestEducationGroup(t, f.db, "Sonne")
	testpkg.AssignStudentToGroup(t, f.db, family.StudentID, group.ID)
	classTeacher, actor, unrelated := f.staff(t, "Lehrkraft"), f.staff(t, "Koordination"), f.staff(t, "Unbeteiligt")
	testpkg.CreateTestClassTeacher(t, f.db, classTeacher.staffID, " 1A ")
	testpkg.CreateTestClassTeacher(t, f.db, actor.staffID, classFeedClass)
	testpkg.CreateTestClassTeacher(t, f.db, unrelated.staffID, "2b")
	groupLead := f.groupTeacher(t, "Betreuung", group.ID)

	tomorrow := classFeedToday.AddDays(1)
	f.dayChange(t, actor, tomorrow, "11:30")

	want := classFeedEntry{Type: "class_timetable_changed", Title: "Stundenplan geändert", Body: "Klasse 1a hat am Di. 11.06. um 11:30 Uhr Schluss.", DeepLink: "/tagesplan?d=2030-06-11"}
	for _, person := range []classFeedPerson{classTeacher, groupLead} {
		entries := f.staffFeed(t, person, testpkg.Tenant(t))
		require.Len(t, entries, 1)
		got := entries[0]
		got.ID, got.ReadAt = 0, nil
		assert.Equal(t, want, got, "the class's Lehrkraft and the lead of its children's group, without the reason")
		assert.Equal(t, []string{"Stundenplan geändert | Klasse 1a hat am Di. 11.06. um 11:30 Uhr Schluss."}, f.pushes(t, person.accountID, "class_timetable_changed"),
			"a change for tomorrow pushes by default")
	}
	assert.Empty(t, f.staffFeed(t, actor, testpkg.Tenant(t)), "the person who made the change gets nothing")
	assert.Empty(t, f.pushes(t, actor.accountID, "class_timetable_changed"))
	assert.Empty(t, f.staffFeed(t, unrelated, testpkg.Tenant(t)), "the Lehrkraft of another class gets nothing")

	entries := f.familyFeed(t, family)
	require.Len(t, entries, 1)
	assert.Equal(t, "parent_class_timetable_changed", entries[0].Type)
	assert.Equal(t, "Klasse 1a hat am Di. 11.06. um 11:30 Uhr Schluss.", entries[0].Body)
	assert.Equal(t, "/children", entries[0].DeepLink)
	assert.Equal(t, []string{"Stundenplan geändert | Der Unterrichtsschluss in der Klasse Ihres Kindes ändert sich. Mehr dazu in moto."},
		f.pushes(t, family.AccountID, "parent_class_timetable_changed"), "the lock screen names no class")
	assert.Empty(t, f.familyFeed(t, otherFamily), "a family of another class gets nothing")

	// Another school of the same Lehrkraft sees nothing of this school.
	foreign := testpkg.NewTenantScope(t, f.db)
	testpkg.MapAccountToTenant(t, f.db, classTeacher.accountID, foreign.TenantID)
	testpkg.AssignLehrkraftSystemRole(t, f.db, classTeacher.accountID, foreign.TenantID)
	assert.Empty(t, f.staffFeed(t, classTeacher, foreign.TenantID))

	// A family that loses the right to the child loses the entry.
	_, err := f.db.ExecContext(context.Background(), `UPDATE auth.guardian_student_access SET permissions = '{}'::jsonb
		WHERE relationship_id IN (SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ?)`, family.GuardianProfileID)
	require.NoError(t, err)
	assert.Empty(t, f.familyFeed(t, family))

	// The school switch stops feed and push for everyone.
	testpkg.SetTestTenantSetting(t, f.db, testpkg.Tenant(t), "notifications.class_timetable_changed_enabled", `false`)
	f.dayChange(t, actor, classFeedToday.AddDays(3), "12:00")
	assert.Len(t, f.staffFeed(t, groupLead, testpkg.Tenant(t)), 1)
	assert.Len(t, f.pushes(t, groupLead.accountID, "class_timetable_changed"), 1)
}

func TestClassTimetableFeedBundlesTheClassAndFollowsTheLeadTime(t *testing.T) {
	t.Parallel()
	f := newClassFeedFixture(t)
	f.family(t, classFeedClass)
	quiet, eager, actor := f.staff(t, "Ruhig"), f.staff(t, "Wach"), f.staff(t, "Koordination")
	for _, person := range []classFeedPerson{quiet, eager} {
		testpkg.CreateTestClassTeacher(t, f.db, person.staffID, classFeedClass)
	}
	f.consent(eager.accountID, "class_timetable_changed_ahead", true)

	// Monday: Wednesday is 2 days ahead, so only who asked for later days
	// hears it on the phone.
	f.weekly(t, actor, careplan.ArrivalScheduleInput{Weekday: 3, ArrivalTime: "12:30"})
	entries := f.staffFeed(t, quiet, testpkg.Tenant(t))
	require.Len(t, entries, 1)
	assert.Equal(t, "Neuer Unterrichtsschluss für Klasse 1a: Mi. 12:30 Uhr. Gilt ab Mi. 12.06.", entries[0].Body)
	assert.Empty(t, f.pushes(t, quiet.accountID, "class_timetable_changed"), "2 days ahead pushes only on request")
	assert.Len(t, f.pushes(t, eager.accountID, "class_timetable_changed"), 1)

	// The same times again change nothing and tell nobody.
	f.weekly(t, actor, careplan.ArrivalScheduleInput{Weekday: 3, ArrivalTime: "12:30"})
	// The next save of the class within the bundle window updates the
	// unread entry instead of adding one, without a second push; a cleared
	// weekday says so.
	f.weekly(t, actor, careplan.ArrivalScheduleInput{Weekday: 1, ArrivalTime: "11:45"}, careplan.ArrivalScheduleInput{Weekday: 3, ArrivalTime: ""})
	entries = f.staffFeed(t, eager, testpkg.Tenant(t))
	require.Len(t, entries, 1, "many saves of one class during the Stundenplanpflege stay one entry")
	assert.Equal(t, "Neuer Unterrichtsschluss für Klasse 1a: Mo. 11:45 Uhr, Mi. keine feste Zeit mehr. Gilt ab Mo. 10.06.", entries[0].Body)
	assert.Len(t, f.pushes(t, eager.accountID, "class_timetable_changed"), 1)
	assert.Empty(t, f.pushes(t, quiet.accountID, "class_timetable_changed"), "an update of a bundled entry pushes no second time")

	// A change more than 14 days ahead reaches the feed only, and so does
	// taking it back.
	later := classFeedToday.AddDays(21)
	f.dayChange(t, actor, later, "10:00")
	f.as(t, actor, func(ctx context.Context) error {
		return f.service.DeleteClassArrivalException(ctx, classFeedClass, later)
	})
	entries = f.staffFeed(t, eager, testpkg.Tenant(t))
	require.Len(t, entries, 1)
	assert.Equal(t, "Klasse 1a hat am Mo. 01.07. wieder zur gewohnten Zeit Schluss.", entries[0].Body)
	assert.Len(t, f.pushes(t, eager.accountID, "class_timetable_changed"), 1)
	assert.Empty(t, f.staffFeed(t, actor, testpkg.Tenant(t)))
}
