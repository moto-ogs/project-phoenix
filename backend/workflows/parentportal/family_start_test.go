package parentportal_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	portal "github.com/moto-ogs/project-phoenix/workflows/parentportal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type familySettings struct {
	batchSettingsStub
	calls       map[int64]int
	unavailable int64
}

func (s *familySettings) ResolveManyForTenant(ctx context.Context, id int64, keys []string) (portal.SettingsSnapshot, error) {
	s.calls[id]++
	if id == s.unavailable {
		return nil, errors.New("unavailable")
	}
	return s.batchSettingsStub.ResolveManyForTenant(ctx, id, keys)
}

type familyAttendance struct {
	portal.AttendanceReader
	calls map[int64]int
}

func (a *familyAttendance) HasAttendance(ctx context.Context, f portal.AttendanceFilter) (bool, error) {
	id, err := tenant.TenantFromContext(ctx)
	if err != nil {
		return false, err
	}
	a.calls[id.Int64()]++
	return a.AttendanceReader.HasAttendance(ctx, f)
}

func TestFamilyStartUsesSchoolFactsButNeverSiblingPermissions(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	svc := buildAllOnParentPortal(t, db)
	family := testpkg.CreateTestParentGuardianChain(t, db)
	foreign := testpkg.CreateTestParentGuardianChain(t, db)
	sibling := testpkg.CreateTestStudent(t, db, "Second", "Child", "1a")
	link := testpkg.CreateTestStudentGuardianLink(t, db, sibling.ID, family.GuardianProfileID, "primary_guardian")
	ctx := testpkg.WithPackageTenantRuntime(context.Background())
	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, link.ID, map[string]interface{}{"parent_portal.access": true}))
	otherSchool, _ := testpkg.CreateTestTenant(t, db)
	testpkg.EnsureAccountTenant(t, db, family.AccountID, otherSchool)
	profile := testpkg.CreateTestGuardianProfileForTenant(t, db, otherSchool, "Parent", "OtherSchool", "portal")
	_, err := db.ExecContext(ctx, "UPDATE users.guardian_profiles SET account_id=?,has_account=true WHERE id=?", family.AccountID, profile.ID)
	require.NoError(t, err)
	third := testpkg.CreateTestStudentForTenant(t, db, otherSchool, "Third", "Child", "2a")
	testpkg.CreateTestStudentGuardianLinkForTenant(t, db, otherSchool, third.ID, profile.ID, "primary_guardian")

	settings := &familySettings{batchSettingsStub: batchSettingsStub{parentSettingsStub{boolDefault: true}}, calls: map[int64]int{}}
	attendance := &familyAttendance{AttendanceReader: parentAttendance(t, db), calls: map[int64]int{}}
	svc.ChildFlows.Settings = settings
	svc.Attendance = attendance
	counter := testpkg.CaptureQueriesForContext(t, db)
	ctx = counter.Context(ctx)
	children, err := svc.ListChildrenForAccount(ctx, family.AccountID)
	require.NoError(t, err)
	require.Len(t, children, 3)
	flags := map[int64]portal.ChildFeatureFlags{}
	status := map[int64]*portal.TodayStatus{}
	for _, child := range children {
		flags[child.StudentID], err = svc.ChildFeatures(ctx, family.AccountID, child.StudentID)
		require.NoError(t, err)
		status[child.StudentID], err = svc.GetChildTodayStatus(ctx, family.AccountID, child.StudentID)
		require.NoError(t, err)
	}
	oldQueries := len(counter.Queries())
	require.Equal(t, map[int64]int{family.TenantID: 2, otherSchool: 1}, settings.calls)
	require.Equal(t, settings.calls, attendance.calls)
	clear(settings.calls)
	clear(attendance.calls)
	counter.Reset()
	snapshot, err := svc.FamilyStart(ctx, family.AccountID, nil)
	require.NoError(t, err)
	require.Len(t, snapshot.Cards, 3)
	t.Logf("same three children across two schools: individual statements=%d, family statements=%d", oldQueries, len(counter.Queries()))
	assert.Less(t, len(counter.Queries()), oldQueries)
	require.Equal(t, map[int64]int{family.TenantID: 1, otherSchool: 1}, settings.calls)
	require.Equal(t, settings.calls, attendance.calls)
	for _, card := range snapshot.Cards {
		require.NotEqual(t, foreign.StudentID, card.Child.StudentID)
		require.NotNil(t, card.Features)
		assert.Equal(t, flags[card.Child.StudentID], *card.Features)
		assert.Equal(t, status[card.Child.StudentID], card.Today)
	}
	require.True(t, flags[family.StudentID].NotesEnabled)
	require.False(t, flags[sibling.ID].NotesEnabled)
	readOne := func(id int64) []portal.FamilyStartCard {
		snapshot, err := svc.FamilyStart(ctx, family.AccountID, &id)
		require.NoError(t, err)
		return snapshot.Cards
	}
	assert.Empty(t, readOne(foreign.StudentID))
	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, link.ID, map[string]interface{}{}))
	assert.Empty(t, readOne(sibling.ID))
	endCareFor(t, db, family.StudentID)
	assert.True(t, readOne(family.StudentID)[0].Features.CareEnded)
	changed, err := db.ExecContext(ctx, `UPDATE users.student_school_memberships SET without_care_place=true, group_id=NULL
 WHERE tenant_id=? AND student_profile_id=? AND deleted_at IS NULL`, otherSchool, third.ID)
	require.NoError(t, err)
	rows, err := changed.RowsAffected()
	require.NoError(t, err)
	require.EqualValues(t, 1, rows)
	settings.unavailable = family.TenantID
	svc.ChildFlows.Now = func() time.Time { return time.Date(2026, 11, 24, 23, 1, 0, 0, time.UTC) }
	snapshot, err = svc.FamilyStart(ctx, family.AccountID, nil)
	require.NoError(t, err)
	require.Len(t, snapshot.Cards, 2)
	assert.Equal(t, calendar.NewDate(2026, 11, 25), snapshot.Day)
	for _, card := range snapshot.Cards {
		if card.Child.StudentID == third.ID {
			require.NotNil(t, card.Features)
			assert.True(t, card.Features.WithoutCarePlace)
			assert.Equal(t, portal.DayStateNoCare, card.Today.State)
		} else {
			assert.Nil(t, card.Features)
			assert.NotNil(t, card.Today)
		}
	}
	empty, err := svc.FamilyStart(ctx, testpkg.CreateTestAccount(t, db, "empty-parent").ID, nil)
	require.NoError(t, err)
	assert.Empty(t, empty.Cards)
}
