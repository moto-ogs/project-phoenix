package httpintegration_test

import (
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The team notices (#7138) are tested like the staffing notices (#7136):
// a change is saved through the real deviation writes, and each account
// reads its own feed through the staff portal's routes. The team of a group
// beyond its assigned teachers is whoever holds it by a Gruppenübergabe on
// the day.

// handover hands the group to the person on the days from to to.
func (f *staffingFixture) handover(t *testing.T, groupID int64, person feedPerson, from, to calendar.Date) {
	t.Helper()
	testpkg.CreateTestGroupSubstitution(t, f.s.db, groupID, nil, person.staffID, from, to)
}

func TestTeamFeedOfASammelVertretung(t *testing.T) {
	t.Parallel()
	f := newStaffingFixture(t)
	group := testpkg.CreateTestEducationGroup(t, f.s.db, "Sonne")
	other := testpkg.CreateTestEducationGroup(t, f.s.db, "Mond")
	actor, absent, substitute := f.person(t, "Leitung"), f.person(t, "Anna"), f.person(t, "Ben")
	holder, otherHolder, pastHolder, unrelated := f.person(t, "Clara"), f.person(t, "Dana"), f.person(t, "Emil"), f.person(t, "Unbeteiligt")
	lead := f.teacher(t, "Lehrkraft", group.ID)
	from, to := calendar.NewDate(2030, 6, 17), calendar.NewDate(2030, 6, 19)
	f.handover(t, group.ID, holder, from, to)
	f.handover(t, group.ID, substitute, from, to)
	f.handover(t, group.ID, actor, from, to)
	f.handover(t, group.ID, pastHolder, calendar.NewDate(2030, 6, 10), calendar.NewDate(2030, 6, 16))
	f.handover(t, other.ID, otherHolder, from, to)
	var dates []calendar.Date
	for day := from; !day.After(to); day = day.AddDays(1) {
		dates = append(dates, day)
		f.groupBlock(t, day, group.ID, absent)
	}

	reason := "Krankheit"
	require.NoError(t, f.bulk(t, timetable.BulkSubstitutionInput{
		AbsentStaffID: absent.staffID, SubstituteStaffID: &substitute.staffID, Dates: dates, Reason: &reason, ActorAccountID: &actor.accountID,
	}))

	team := f.entries(t, holder)
	assert.Equal(t, []feedEntry{{
		Type: "team_member_absent", Title: "Ausfall im Team", Body: "Anna Feed ist an 3 Tagen (17.–19.06.) nicht da.", DeepLink: "/tagesplan?d=2030-06-17",
	}}, team, "one entry for the whole absence, without a reason")
	assert.NotContains(t, strings.ToLower(team[0].Body), "krank")
	assert.Equal(t, 1, f.typedPushes(t, holder, "team_member_absent"), "push is on by default, once per absence")

	assert.Equal(t, []string{"group_staffing_changed"}, entryTypes(f.entries(t, lead)), "the group's teacher hears it once, as the teacher")
	assert.Equal(t, []string{"staffing_changed"}, entryTypes(f.entries(t, substitute)), "the substitute hears it once, as the substitute")
	assert.Equal(t, []string{"staffing_changed"}, entryTypes(f.entries(t, absent)), "the absent person is no team of their own absence")
	assert.Empty(t, f.entries(t, actor), "the person who saved gets nothing, also when holding the group")
	assert.Empty(t, f.entries(t, pastHolder), "a handover that ended before the absence makes no team")
	assert.Empty(t, f.entries(t, otherHolder), "the team of another group gets nothing")
	assert.Empty(t, f.entries(t, unrelated))

	// Another school of the same team member sees nothing of this school.
	foreign := testpkg.NewTenantScope(t, f.s.db)
	testpkg.MapAccountToTenant(t, f.s.db, holder.accountID, foreign.TenantID)
	testpkg.AssignLehrkraftSystemRole(t, f.s.db, holder.accountID, foreign.TenantID)
	code, body := f.call(t, holder.accountID, foreign.TenantID, "GET", "/api/notifications/feed")
	require.Equal(t, 200, code, string(body))
	assert.Contains(t, string(body), `"entries":[]`)
}

func TestTeamFeedOfAnAbsenceItsReturnAndTheSchoolSwitch(t *testing.T) {
	t.Parallel()
	f := newStaffingFixture(t)
	group := testpkg.CreateTestEducationGroup(t, f.s.db, "Stern")
	actor, absent, substitute, holder := f.person(t, "Leitung"), f.person(t, "Anna"), f.person(t, "Ben"), f.person(t, "Clara")
	day := calendar.NewDate(2030, 6, 11)
	f.handover(t, group.ID, holder, day, calendar.NewDate(2030, 7, 31))
	uncovered := f.groupBlock(t, day, group.ID, absent)
	covered := f.groupBlock(t, day, group.ID, absent)

	// One save: not there in one block, substituted in the other. To the
	// team that is one absence.
	require.NoError(t, f.apply(t, uncovered, timetable.ApplyDeviationsInput{
		Absences:       []timetable.DeviationAbsenceInput{{StaffID: absent.staffID, InstanceIDs: &[]int64{uncovered}}},
		Substitutions:  []timetable.DeviationSubstitutionInput{{AbsentStaffID: absent.staffID, SubstituteStaffID: substitute.staffID, InstanceIDs: &[]int64{covered}}},
		ActorAccountID: &actor.accountID,
	}))
	assert.Equal(t, []feedEntry{{Type: "team_member_absent", Title: "Ausfall im Team", Body: "Anna Feed ist am Di. 11.06. nicht da.", DeepLink: "/tagesplan?d=2030-06-11"}},
		f.entries(t, holder))

	// Taking it back is an entry of its own and pushes like the absence.
	require.NoError(t, f.apply(t, uncovered, timetable.ApplyDeviationsInput{
		Presences: []timetable.DeviationPresenceInput{{StaffID: absent.staffID, InstanceIDs: &[]int64{uncovered}}}, ActorAccountID: &actor.accountID,
	}))
	entries := f.entries(t, holder)
	require.Len(t, entries, 2)
	assert.Equal(t, feedEntry{Type: "team_member_absent", Title: "Dienstplan geändert", Body: "Anna Feed ist am Di. 11.06. doch da.", DeepLink: "/tagesplan?d=2030-06-11"}, entries[0])
	assert.Equal(t, 2, f.typedPushes(t, holder, "team_member_absent"))

	// A cover entered later for a person already marked absent, as after a
	// sick report, is no second absence to the team.
	thursday := f.groupBlock(t, calendar.NewDate(2030, 6, 13), group.ID, absent)
	require.NoError(t, f.apply(t, thursday, timetable.ApplyDeviationsInput{
		Absences: []timetable.DeviationAbsenceInput{{StaffID: absent.staffID}}, ActorAccountID: &actor.accountID,
	}))
	require.NoError(t, f.apply(t, thursday, timetable.ApplyDeviationsInput{
		Substitutions:  []timetable.DeviationSubstitutionInput{{AbsentStaffID: absent.staffID, SubstituteStaffID: substitute.staffID}},
		ActorAccountID: &actor.accountID,
	}))
	entries = f.entries(t, holder)
	require.Len(t, entries, 3)
	assert.Equal(t, "Anna Feed ist am Do. 13.06. nicht da.", entries[0].Body)
	assert.Equal(t, 3, f.typedPushes(t, holder, "team_member_absent"))

	// More than 14 days ahead reaches the feed only.
	later := f.groupBlock(t, calendar.NewDate(2030, 7, 1), group.ID, absent)
	require.NoError(t, f.apply(t, later, timetable.ApplyDeviationsInput{
		Absences: []timetable.DeviationAbsenceInput{{StaffID: absent.staffID}}, ActorAccountID: &actor.accountID,
	}))
	require.Len(t, f.entries(t, holder), 4)
	assert.Equal(t, "Anna Feed ist am Mo. 01.07. nicht da.", f.entries(t, holder)[0].Body)
	assert.Equal(t, 3, f.typedPushes(t, holder, "team_member_absent"))

	// The school switch stops feed and push.
	testpkg.SetTestTenantSetting(t, f.s.db, testpkg.Tenant(t), "notifications.staffing_changed_enabled", `false`)
	soon := f.groupBlock(t, calendar.NewDate(2030, 6, 12), group.ID, absent)
	require.NoError(t, f.apply(t, soon, timetable.ApplyDeviationsInput{
		Absences: []timetable.DeviationAbsenceInput{{StaffID: absent.staffID}}, ActorAccountID: &actor.accountID,
	}))
	assert.Len(t, f.entries(t, holder), 4)
	assert.Equal(t, 3, f.typedPushes(t, holder, "team_member_absent"))
}

func entryTypes(entries []feedEntry) []string {
	types := make([]string, 0, len(entries))
	for _, entry := range entries {
		types = append(types, entry.Type)
	}
	return types
}
