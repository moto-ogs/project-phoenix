package httpintegration_test

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The staffing notices (#7136) are tested from the outside, like the
// cancellation's: a substitution is saved through the real deviation writes,
// Delivery writes the feed and the push outbox in that transaction, and each
// account reads its own feed through the staff portal's routes.

type staffingFixture struct {
	*feedFixture
	deviations timetable.StaffDeviations
}

func newStaffingFixture(t *testing.T) *staffingFixture {
	t.Helper()
	f := newFeedFixture(t)
	database := testpkg.NewDatabase(t, f.s.db)
	module, err := api.NewDeliveryTestModule(database, testpkg.TenantRuntime(t, f.s.db))
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, testpkg.TenantRuntime(t, f.s.db))
	require.NoError(t, err)
	notifier, err := api.NewDeliveryTestFeedNotifier(database, testpkg.TenantRuntime(t, f.s.db), settings.Settings, module)
	require.NoError(t, err)
	notices := owners.NewTimetableStaffNotices(owners.DeliveryNotifications{Notifier: notifier, Preferences: module.NotificationPreferences},
		owners.MustNewSchoolMembership(database), owners.MustNewUnobservedTimetable(database))
	require.NotNil(t, notices.Staffing.Notices)

	repos, err := api.NewTimetableTestRepositories(database)
	require.NoError(t, err)
	lifecycle, err := compose.NewInstanceLifecycle(lifecycleDependencies(f.s, nil))
	require.NoError(t, err)
	now := func() time.Time { return feedNow }
	deps, err := owners.TimetableStaffDeviationDependencies(repos.OwnerRows(), owners.NewTimetableStaff(f.s.reposPeople.Staff), f.s.repos.GroupSupervisor,
		lifecycle.DeviationLifecycle(), testpkg.NewRecordingBroadcaster(), slog.Default(), now)
	require.NoError(t, err)
	deps.Locks = compose.NewTenantDatabase(f.s.db)
	deps.StaffingNotices = notices.Staffing
	deviations, err := compose.NewStaffDeviations(deps)
	require.NoError(t, err)
	return &staffingFixture{feedFixture: f, deviations: deviations}
}

// groupBlock is a planned block of an OGS group led by the teacher, staffed
// by the given people.
func (f *staffingFixture) groupBlock(t *testing.T, date calendar.Date, groupID int64, staff ...feedPerson) int64 {
	t.Helper()
	template := testpkg.CreateTestActivityGroup(t, f.s.db, "Gruppenzeit")
	_, err := f.s.db.ExecContext(context.Background(), `UPDATE activities.groups SET education_group_id = ? WHERE id = ?`, groupID, template.ID)
	require.NoError(t, err)
	instance := testpkg.CreateTestActivityInstance(t, f.s.db, date, f.s.roomID, testpkg.ActivityInstanceOpts{Title: "Gruppenzeit", ActivityGroupID: &template.ID})
	for _, person := range staff {
		testpkg.CreateTestInstanceStaff(t, f.s.db, instance.ID, person.staffID, testpkg.InstanceStaffOpts{})
	}
	return instance.ID
}

// teacher is a person with an account who leads the OGS group.
func (f *staffingFixture) teacher(t *testing.T, name string, groupID int64) feedPerson {
	t.Helper()
	teacher, account := testpkg.CreateTestTeacherWithAccount(t, f.s.db, name, "Feed")
	testpkg.MapAccountToTenant(t, f.s.db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, f.s.db, account.ID, testpkg.Tenant(t))
	testpkg.CreateTestGroupTeacher(t, f.s.db, groupID, teacher.ID)
	_, err := f.s.db.ExecContext(context.Background(), `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'staff', ?, 'test-p256dh', 'test-auth')`, testpkg.Tenant(t), account.ID, "https://fcm.googleapis.com/fcm/send/feed-teacher-"+int64String(account.ID))
	require.NoError(t, err)
	return feedPerson{staffID: teacher.StaffID, accountID: account.ID}
}

func (f *staffingFixture) entries(t *testing.T, person feedPerson) []feedEntry {
	t.Helper()
	feed := f.feed(t, person, "")
	out := make([]feedEntry, 0, len(feed.Data.Entries))
	for _, entry := range feed.Data.Entries {
		out = append(out, feedEntry{Type: entry.Type, Title: entry.Title, Body: entry.Body, DeepLink: entry.DeepLink})
	}
	return out
}

// apply saves a Vertretungsplan change in a tenant transaction, as the
// request's transaction runs it.
func (f *staffingFixture) apply(t *testing.T, instanceID int64, in timetable.ApplyDeviationsInput) error {
	t.Helper()
	return testpkg.TenantCommand0(t, f.s.ctx, f.s.db, func(ctx context.Context) error {
		_, err := f.deviations.ApplyDeviations(ctx, instanceID, in)
		return err
	})
}

// bulk saves a Sammel-Vertretung in a tenant transaction.
func (f *staffingFixture) bulk(t *testing.T, in timetable.BulkSubstitutionInput) error {
	t.Helper()
	return testpkg.TenantCommand0(t, f.s.ctx, f.s.db, func(ctx context.Context) error {
		_, err := f.deviations.ApplyBulkSubstitution(ctx, in)
		return err
	})
}

type feedEntry struct{ Type, Title, Body, DeepLink string }

// typedPushes counts the push intents of the type for the account.
func (f *staffingFixture) typedPushes(t *testing.T, person feedPerson, kind string) int {
	t.Helper()
	count, err := f.s.db.NewSelect().TableExpr("platform.push_outbox").
		Where("tenant_id = ?", testpkg.Tenant(t)).
		Where("(recipient->>'account_id')::bigint = ?", person.accountID).
		Where("payload->>'type' = ?", kind).
		Count(context.Background())
	require.NoError(t, err)
	return int(count)
}

func TestStaffingFeedOfASingleSave(t *testing.T) {
	t.Parallel()
	f := newStaffingFixture(t)
	group := testpkg.CreateTestEducationGroup(t, f.s.db, "Sonne")
	actor, absent, substitute, unrelated := f.person(t, "Leitung"), f.person(t, "Anna"), f.person(t, "Ben"), f.person(t, "Unbeteiligt")
	lead := f.teacher(t, "Lehrkraft", group.ID)
	day := calendar.NewDate(2030, 6, 11)
	instanceID := f.groupBlock(t, day, group.ID, absent)

	reason := "Krankheit"
	err := f.apply(t, instanceID, timetable.ApplyDeviationsInput{
		Substitutions:  []timetable.DeviationSubstitutionInput{{AbsentStaffID: absent.staffID, SubstituteStaffID: substitute.staffID, Reason: &reason}},
		ActorAccountID: &actor.accountID,
	})
	require.NoError(t, err)

	assert.Equal(t, []feedEntry{{Type: "staffing_changed", Title: "Sie vertreten", Body: "Sie vertreten Anna Feed am Di. 11.06.", DeepLink: "/mein-dienstplan?d=2030-06-11"}}, f.entries(t, substitute))
	assert.Equal(t, []feedEntry{{Type: "staffing_changed", Title: "Sie werden vertreten", Body: "Ben Feed vertritt Sie am Di. 11.06.", DeepLink: "/mein-dienstplan?d=2030-06-11"}}, f.entries(t, absent))
	teacher := f.entries(t, lead)
	require.Len(t, teacher, 1)
	assert.Equal(t, feedEntry{
		Type: "group_staffing_changed", Title: "Vertretung in Ihrer Gruppe", Body: "Ben Feed vertritt Anna Feed am Di. 11.06.",
		DeepLink: "/vertretung?d=2030-06-11&block=" + int64String(instanceID),
	}, teacher[0])
	for _, person := range []feedPerson{substitute, absent, lead} {
		for _, entry := range f.entries(t, person) {
			assert.NotContains(t, strings.ToLower(entry.Body), "krank", "the reason never reaches the text")
		}
	}
	assert.Empty(t, f.entries(t, actor), "the person who saved gets nothing")
	assert.Empty(t, f.entries(t, unrelated), "who is not concerned gets nothing")
	assert.Equal(t, 1, f.typedPushes(t, substitute, "staffing_changed"))
	assert.Equal(t, 1, f.typedPushes(t, lead, "group_staffing_changed"))
	assert.Zero(t, f.typedPushes(t, actor, "staffing_changed"))

	// Another school of the same teacher sees nothing of this school.
	foreign := testpkg.NewTenantScope(t, f.s.db)
	testpkg.MapAccountToTenant(t, f.s.db, lead.accountID, foreign.TenantID)
	testpkg.AssignLehrkraftSystemRole(t, f.s.db, lead.accountID, foreign.TenantID)
	code, body := f.call(t, lead.accountID, foreign.TenantID, "GET", "/api/notifications/feed")
	require.Equal(t, 200, code, string(body))
	assert.Contains(t, string(body), `"entries":[]`)
}

func TestStaffingFeedOfASammelVertretungIsOneEntry(t *testing.T) {
	t.Parallel()
	f := newStaffingFixture(t)
	group := testpkg.CreateTestEducationGroup(t, f.s.db, "Mond")
	actor, absent, substitute := f.person(t, "Leitung"), f.person(t, "Anna"), f.person(t, "Ben")
	lead := f.teacher(t, "Lehrkraft", group.ID)
	var dates []calendar.Date
	for day := 17; day <= 21; day++ {
		date := calendar.NewDate(2030, 6, day)
		dates = append(dates, date)
		f.groupBlock(t, date, group.ID, absent)
	}

	err := f.bulk(t, timetable.BulkSubstitutionInput{
		AbsentStaffID: absent.staffID, SubstituteStaffID: &substitute.staffID, Dates: dates, ActorAccountID: &actor.accountID,
	})
	require.NoError(t, err)

	own := f.entries(t, substitute)
	require.Len(t, own, 1, "one entry for the whole Sammel-Vertretung")
	assert.Equal(t, "Sie vertreten Anna Feed an 5 Tagen (17.–21.06.).", own[0].Body)
	assert.Equal(t, "/mein-dienstplan?d=2030-06-17", own[0].DeepLink)
	teacher := f.entries(t, lead)
	require.Len(t, teacher, 1)
	assert.Equal(t, "Ben Feed vertritt Anna Feed an 5 Tagen (17.–21.06.).", teacher[0].Body)
	assert.Equal(t, 1, f.typedPushes(t, substitute, "staffing_changed"), "one push, not one per day")
	assert.Empty(t, f.entries(t, actor))
}

func TestStaffingFeedOfAnAbsenceFarAheadAndTheSchoolSwitch(t *testing.T) {
	t.Parallel()
	f := newStaffingFixture(t)
	group := testpkg.CreateTestEducationGroup(t, f.s.db, "Stern")
	actor, absent := f.person(t, "Leitung"), f.person(t, "Anna")
	lead := f.teacher(t, "Lehrkraft", group.ID)
	later := f.groupBlock(t, calendar.NewDate(2030, 7, 1), group.ID, absent)

	err := f.apply(t, later, timetable.ApplyDeviationsInput{
		Absences: []timetable.DeviationAbsenceInput{{StaffID: absent.staffID}}, ActorAccountID: &actor.accountID,
	})
	require.NoError(t, err)
	assert.Equal(t, []feedEntry{{Type: "group_staffing_changed", Title: "Ausfall in Ihrer Gruppe", Body: "Anna Feed ist am Mo. 01.07. nicht da.",
		DeepLink: "/vertretung?d=2030-07-01&block=" + int64String(later)}}, f.entries(t, lead))
	assert.Equal(t, "Sie sind am Mo. 01.07. als nicht da eingetragen.", f.entries(t, absent)[0].Body)
	assert.Zero(t, f.typedPushes(t, lead, "group_staffing_changed"), "more than 14 days ahead reaches the feed only")

	testpkg.SetTestTenantSetting(t, f.s.db, testpkg.Tenant(t), "notifications.staffing_changed_enabled", `false`)
	soon := f.groupBlock(t, calendar.NewDate(2030, 6, 12), group.ID, absent)
	err = f.apply(t, soon, timetable.ApplyDeviationsInput{
		Absences: []timetable.DeviationAbsenceInput{{StaffID: absent.staffID}}, ActorAccountID: &actor.accountID,
	})
	require.NoError(t, err)
	assert.Len(t, f.entries(t, lead), 1, "a school that switched the type off gets no entry")
	assert.Zero(t, f.typedPushes(t, lead, "group_staffing_changed"))
}

func int64String(value int64) string { return strconv.FormatInt(value, 10) }
