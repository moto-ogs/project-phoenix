package groups_test

import (
	"errors"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func setupClassTeacherService(t *testing.T, db *bun.DB) (Service, *owners.SchoolStructureSuiteRepositories, *api.PeopleRepositorySuiteFactory) {
	t.Helper()
	repos := api.NewPeopleRepositorySuiteFactory(testpkg.NewDatabase(t, db))
	reposStructure := owners.NewSchoolStructureSuiteRepositories(testpkg.NewDatabase(t, db))
	// Same wiring the service factory uses: assignment rewrites must land in
	// the Stammdaten audit trail.
	return api.NewEducationSuiteService(repos, testpkg.NewDatabase(t, db)), reposStructure, repos
}

func TestSetStaffSchoolClasses(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	svc, repos, reposPeople := setupClassTeacherService(t, db)
	ctx := testpkg.Ctx(t)

	actor := testpkg.CreateTestAccount(t, db, "class-teacher-actor@test.local")
	// set saves the classes on the assignments it reads first (ADR 0311).
	set := func(staffID int64, classes []string) error {
		read, err := testpkg.TenantQuery1(t, ctx, db, svc.GetStaffSchoolClasses, staffID)
		version := ""
		if err == nil {
			version = schoolstructure.StaffSchoolClassesVersion(read)
		}
		return testpkg.TenantCommand4(t, ctx, db, svc.SetStaffSchoolClasses, staffID, classes, version, actor.ID)
	}

	t.Run("assigns and reads classes", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "Assign")

		require.NoError(t, set(staff.ID, []string{"2b", "1a"}))

		classes, err := testpkg.TenantQuery1(t, ctx, db, svc.GetStaffSchoolClasses, staff.ID)
		require.NoError(t, err)
		assert.Equal(t, []string{"1a", "2b"}, classes)
	})

	t.Run("dedupes case-insensitively and trims", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "Dedupe")

		require.NoError(t, set(staff.ID, []string{"1a", " 1A ", "2b"}))

		classes, err := testpkg.TenantQuery1(t, ctx, db, svc.GetStaffSchoolClasses, staff.ID)
		require.NoError(t, err)
		assert.Equal(t, []string{"1a", "2b"}, classes)
	})

	t.Run("resubmitting the same set keeps existing rows", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "Resubmit")

		require.NoError(t, set(staff.ID, []string{"1a", "2b"}))
		before, err := repos.ClassTeacher.FindByStaff(ctx, staff.ID)
		require.NoError(t, err)

		require.NoError(t, set(staff.ID, []string{"2b", "1a"}))
		after, err := repos.ClassTeacher.FindByStaff(ctx, staff.ID)
		require.NoError(t, err)

		require.Len(t, after, len(before))
		for i := range before {
			assert.Equal(t, before[i].ID, after[i].ID, "unchanged assignments must keep their row")
		}
	})

	t.Run("case-only edit updates the stored display form in place", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "CaseEdit")

		require.NoError(t, set(staff.ID, []string{"1a"}))
		before, err := repos.ClassTeacher.FindByStaff(ctx, staff.ID)
		require.NoError(t, err)
		require.Len(t, before, 1)

		require.NoError(t, set(staff.ID, []string{"1A"}))
		after, err := repos.ClassTeacher.FindByStaff(ctx, staff.ID)
		require.NoError(t, err)
		require.Len(t, after, 1)
		assert.Equal(t, before[0].ID, after[0].ID, "a case edit must not recreate the row")
		assert.Equal(t, "1A", after[0].SchoolClass, "the submitted casing must win")
	})

	t.Run("replaces the set with a diff", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "Replace")

		require.NoError(t, set(staff.ID, []string{"1a", "2b"}))
		require.NoError(t, set(staff.ID, []string{"2b", "3c"}))

		classes, err := testpkg.TenantQuery1(t, ctx, db, svc.GetStaffSchoolClasses, staff.ID)
		require.NoError(t, err)
		assert.Equal(t, []string{"2b", "3c"}, classes)
	})

	t.Run("clears assignments with an empty set", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "Clear")

		require.NoError(t, set(staff.ID, []string{"1a"}))
		require.NoError(t, set(staff.ID, []string{}))

		classes, err := testpkg.TenantQuery1(t, ctx, db, svc.GetStaffSchoolClasses, staff.ID)
		require.NoError(t, err)
		assert.Empty(t, classes)
	})

	t.Run("audits every actual change, skips no-ops", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "Audit")

		auditCount := func() int {
			count, err := db.NewSelect().
				TableExpr("audit.staff_master_data_changes").
				Where("staff_id = ?", staff.ID).
				Where("section = ?", testpkg.AuditStammdatenSectionSchoolClasses).
				Count(ctx)
			require.NoError(t, err)
			return int(count)
		}

		require.NoError(t, set(staff.ID, []string{"1a"}))
		assert.Equal(t, 1, auditCount(), "the initial assignment is a change")

		require.NoError(t, set(staff.ID, []string{"1a"}))
		assert.Equal(t, 1, auditCount(), "a no-op resubmit must not write a row")

		require.NoError(t, set(staff.ID, []string{"2b"}))
		assert.Equal(t, 2, auditCount(), "a replace is a change")

		// A case-only rename mutates the same rows the audit snapshot is
		// derived from — the trail must still record it (the exact casing
		// decides how a grade transition matches this teacher).
		require.NoError(t, set(staff.ID, []string{"2B"}))
		assert.Equal(t, 3, auditCount(), "a case-only rename is a change and must be audited")

		var row struct {
			ChangedBy int64  `bun:"changed_by"`
			OldValue  string `bun:"old_value"`
			NewValue  string `bun:"new_value"`
		}
		err := db.NewSelect().
			TableExpr("audit.staff_master_data_changes").
			Column("changed_by", "old_value", "new_value").
			Where("staff_id = ?", staff.ID).
			Where("section = ?", testpkg.AuditStammdatenSectionSchoolClasses).
			OrderExpr("id DESC").
			Limit(1).
			Scan(ctx, &row)
		require.NoError(t, err)
		assert.Equal(t, actor.ID, row.ChangedBy)
		assert.Equal(t, "2b", row.OldValue, "the audit must snapshot the pre-write display form")
		assert.Equal(t, "2B", row.NewValue)
	})

	t.Run("rejects blank class names", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "Blank")

		err := set(staff.ID, []string{"1a", "   "})
		require.Error(t, err)
		assert.True(t, errors.Is(err, ErrEmptySchoolClass))
	})

	t.Run("rejects unknown staff", func(t *testing.T) {
		ghost := testpkg.CreateTestStaff(t, db, "CTSvc", "Ghost")
		ghostID := ghost.ID
		// Deleting the staff row is the ARRANGE step: both calls must report
		// ErrStaffNotFound for an ID that no longer exists (#2419).
		require.NoError(t, testpkg.TenantCommand1(t, ctx, db, reposPeople.Staff.Delete, any(ghostID)))

		err := set(ghostID, []string{"1a"})
		require.Error(t, err)
		assert.True(t, errors.Is(err, ErrStaffNotFound))

		_, err = testpkg.TenantQuery1(t, ctx, db, svc.GetStaffSchoolClasses, ghostID)
		require.Error(t, err)
		assert.True(t, errors.Is(err, ErrStaffNotFound))
	})

	t.Run("refuses assignments changed since they were read", func(t *testing.T) {
		staff := testpkg.CreateTestStaff(t, db, "CTSvc", "Stale")
		require.NoError(t, set(staff.ID, []string{"1a"}))
		read, err := testpkg.TenantQuery1(t, ctx, db, svc.GetStaffSchoolClasses, staff.ID)
		require.NoError(t, err)
		shown := schoolstructure.StaffSchoolClassesVersion(read)
		// Someone else saves 2b meanwhile.
		require.NoError(t, set(staff.ID, []string{"1a", "2b"}))

		err = testpkg.TenantCommand4(t, ctx, db, svc.SetStaffSchoolClasses, staff.ID, []string{"1a", "3c"}, shown, actor.ID)
		require.ErrorIs(t, err, readstate.ErrChanged)
		err = testpkg.TenantCommand4(t, ctx, db, svc.SetStaffSchoolClasses, staff.ID, []string{"3c"}, "", actor.ID)
		require.ErrorIs(t, err, readstate.ErrChanged, "a save without a read is refused")

		classes, err := testpkg.TenantQuery1(t, ctx, db, svc.GetStaffSchoolClasses, staff.ID)
		require.NoError(t, err)
		assert.Equal(t, []string{"1a", "2b"}, classes, "the refused saves wrote nothing")
	})
}
