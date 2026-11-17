package api

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/roots/owners"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestClassListConversionTurnsEntriesIntoChildrenWithoutCarePlace converts a
// school's class list (#4803, ADR 0282): an entry whose name a child of its
// class already carries joins that child, every other entry becomes a child
// without an OGS place, the morning marks follow, the entries go and the
// trail names the child each entry became.
func TestClassListConversionTurnsEntriesIntoChildrenWithoutCarePlace(t *testing.T) {
	t.Parallel()
	db, module, _, _ := setupImportModule(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)

	existing := testpkg.CreateTestStudent(t, db, "Ben", "Busch", "2a")
	joining := testpkg.CreateTestClassListEntry(t, db, "Ben", "Busch", "2a")
	newcomer := testpkg.CreateTestClassListEntry(t, db, "Lea", "Lang", "2a")
	_, err := db.ExecContext(ctx, `INSERT INTO active.morning_attendance (tenant_id, date, class_list_entry_id, status)
		VALUES (?, '2026-11-16', ?, 'absent')`, tenantID, newcomer.ID)
	require.NoError(t, err)

	actor := testpkg.CreateTestAccount(t, db, "konvertierung@example.com")
	var created, joined int
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, tenantID, func(txCtx context.Context) error {
		result, err := module.ClassListConversion.ConvertClassListEntries(txCtx, &actor.ID)
		created, joined = result.Created, result.Joined
		return err
	}))
	assert.Equal(t, 1, created)
	assert.Equal(t, 1, joined)

	var entries int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM users.class_list_entries WHERE tenant_id = ?`, tenantID).Scan(ctx, &entries))
	assert.Zero(t, entries, "the entries are gone")

	var lea struct {
		StudentID        int64  `bun:"student_id"`
		WithoutCarePlace bool   `bun:"without_care_place"`
		GroupID          *int64 `bun:"group_id"`
		Status           string `bun:"status"`
	}
	require.NoError(t, db.NewRaw(`SELECT m.student_profile_id AS student_id, m.without_care_place, m.group_id, m.status
		FROM users.student_school_memberships m
		JOIN users.student_profiles p ON p.tenant_id = m.tenant_id AND p.id = m.student_profile_id
		JOIN users.persons person ON person.tenant_id = p.tenant_id AND person.id = p.person_id
		WHERE m.tenant_id = ? AND m.deleted_at IS NULL AND person.first_name = 'Lea' AND person.last_name = 'Lang'`, tenantID).Scan(ctx, &lea))
	assert.True(t, lea.WithoutCarePlace, "the new child has no OGS place")
	assert.Nil(t, lea.GroupID)
	assert.Equal(t, "active", lea.Status)

	var benWithoutPlace bool
	require.NoError(t, db.NewRaw(`SELECT without_care_place FROM users.student_school_memberships
		WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, tenantID, existing.ID).Scan(ctx, &benWithoutPlace))
	assert.False(t, benWithoutPlace, "the existing child keeps its OGS place")

	var markStudent int64
	require.NoError(t, db.NewRaw(`SELECT student_id FROM active.morning_attendance WHERE tenant_id = ? AND date = '2026-11-16'`, tenantID).Scan(ctx, &markStudent))
	assert.Equal(t, lea.StudentID, markStudent, "the morning mark follows the child")

	var trail []struct {
		EntryID          int64 `bun:"entry_id"`
		MatchedStudentID int64 `bun:"matched_student_id"`
	}
	require.NoError(t, db.NewRaw(`SELECT entry_id, matched_student_id FROM audit.class_list_entry_changes
		WHERE tenant_id = ? AND action = 'assigned' ORDER BY entry_id`, tenantID).Scan(ctx, &trail))
	require.Len(t, trail, 2)
	matched := map[int64]int64{trail[0].EntryID: trail[0].MatchedStudentID, trail[1].EntryID: trail[1].MatchedStudentID}
	assert.Equal(t, existing.ID, matched[joining.ID])
	assert.Equal(t, lea.StudentID, matched[newcomer.ID])
}

// TestRenewalGivesAChildWithoutCarePlaceItsPlace renews the enrollment of a
// child without an OGS place, as an approved enrollment for the existing
// child does (#4803): the child gets its OGS place.
func TestRenewalGivesAChildWithoutCarePlaceItsPlace(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := calendar.Date("2026-11-17")
	people, err := owners.NewPeopleDirectory(testpkg.NewDatabase(t, db), func() time.Time { return today.BerlinMidnight() })
	require.NoError(t, err)
	ctx := testpkg.Ctx(t)
	child := testpkg.CreateTestStudent(t, db, "Bald", "Angemeldet", "3c")
	testpkg.MarkTestStudentWithoutCarePlace(t, db, child.ID)

	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, testpkg.Tenant(t), func(txCtx context.Context) error {
		return people.RenewEnrollmentStudent(txCtx, child.ID, peopledirectory.EnrollmentStudent{SchoolClass: "3c", Status: peopledirectory.StudentStatusActive})
	}))

	var withoutPlace, dated bool
	var firstCare *calendar.Date
	require.NoError(t, db.NewRaw(`SELECT without_care_place, enrolled_from IS NOT NULL, first_care_from FROM users.student_school_memberships
		WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), child.ID).Scan(ctx, &withoutPlace, &dated, &firstCare))
	assert.False(t, withoutPlace, "the renewal gives the child its OGS place")
	assert.True(t, dated, "the OGS care starts with the place, so no past day turns into OGS participation")
	require.NotNil(t, firstCare, "the first OGS place must bound historical care")
	assert.Equal(t, today, *firstCare)
	yesterday := today.AddDays(-1).String()
	roster, err := people.ListStudentRosterOverlapping(ctx, yesterday, yesterday, today.String())
	require.NoError(t, err)
	assert.Empty(t, roster, "granting the first place must not add the child to historical care reports")
}
