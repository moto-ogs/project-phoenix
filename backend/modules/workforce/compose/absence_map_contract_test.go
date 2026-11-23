package compose

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// absenceMapDay is the fixed school Tuesday the absence map contract reads.
var absenceMapDay = calendar.NewDate(2026, time.November, 10)

func TestStaffAbsenceMapContract(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	repo := buildWorkforce(t, db)
	ctx := testpkg.Ctx(t)

	t.Run("returns absence map for today", func(t *testing.T) {
		staff1 := testpkg.CreateTestStaff(t, db, "Staff", "One")
		staff2 := testpkg.CreateTestStaff(t, db, "Staff", "Two")
		today := absenceMapDay

		absence1 := workforce.StaffAbsence{
			StaffID:     ident.ID(staff1.ID),
			AbsenceType: workforce.AbsenceTypeSick,
			DateStart:   today.String(),
			DateEnd:     today.String(),
			Status:      workforce.AbsenceStatusReported,
			CreatedBy:   ident.ID(staff1.ID),
		}

		absence2 := workforce.StaffAbsence{
			StaffID:     ident.ID(staff2.ID),
			AbsenceType: workforce.AbsenceTypeVacation,
			DateStart:   today.String(),
			DateEnd:     today.String(),
			Status:      workforce.AbsenceStatusApproved,
			CreatedBy:   ident.ID(staff2.ID),
		}

		_, err := repo.CreateStaffAbsence(ctx, &absence1)
		require.NoError(t, err)
		_, err = repo.CreateStaffAbsence(ctx, &absence2)
		require.NoError(t, err)

		absenceMap, err := repo.StaffAbsenceMapForDate(ctx, today.String())
		require.NoError(t, err)
		assert.Equal(t, workforce.AbsenceTypeSick, absenceMap[staff1.ID])
		assert.Equal(t, workforce.AbsenceTypeVacation, absenceMap[staff2.ID])
	})

	t.Run("prioritizes sick over vacation", func(t *testing.T) {
		staff3 := testpkg.CreateTestStaff(t, db, "Staff", "Three")
		today := absenceMapDay

		// Create two overlapping absences for same staff
		absence1 := workforce.StaffAbsence{
			StaffID:     ident.ID(staff3.ID),
			AbsenceType: workforce.AbsenceTypeVacation,
			DateStart:   today.String(),
			DateEnd:     today.String(),
			Status:      workforce.AbsenceStatusApproved,
			CreatedBy:   ident.ID(staff3.ID),
		}

		absence2 := workforce.StaffAbsence{
			StaffID:     ident.ID(staff3.ID),
			AbsenceType: workforce.AbsenceTypeSick,
			DateStart:   today.String(),
			DateEnd:     today.String(),
			Status:      workforce.AbsenceStatusReported,
			CreatedBy:   ident.ID(staff3.ID),
		}

		_, err := repo.CreateStaffAbsence(ctx, &absence1)
		require.NoError(t, err)
		_, err = repo.CreateStaffAbsence(ctx, &absence2)
		require.NoError(t, err)

		absenceMap, err := repo.StaffAbsenceMapForDate(ctx, today.String())
		require.NoError(t, err)
		// Sick should take priority over vacation
		assert.Equal(t, workforce.AbsenceTypeSick, absenceMap[staff3.ID])
	})

	t.Run("uses the requested date", func(t *testing.T) {
		staff1 := testpkg.CreateTestStaff(t, db, "Staff", "One")
		requestedDate := absenceMapDay.AddDays(30)
		absence := workforce.StaffAbsence{
			StaffID:     ident.ID(staff1.ID),
			AbsenceType: workforce.AbsenceTypeTraining,
			DateStart:   requestedDate.String(),
			DateEnd:     requestedDate.String(),
			Status:      workforce.AbsenceStatusApproved,
			CreatedBy:   ident.ID(staff1.ID),
		}

		_, createErr := repo.CreateStaffAbsence(ctx, &absence)
		require.NoError(t, createErr)

		absenceMap, err := repo.StaffAbsenceMapForDate(ctx, requestedDate.String())
		require.NoError(t, err)
		assert.Equal(t, workforce.AbsenceTypeTraining, absenceMap[staff1.ID])
	})

	t.Run("uses the same ID tie-breaker for type and label maps", func(t *testing.T) {
		staff1 := testpkg.CreateTestStaff(t, db, "Staff", "Tie Breaker")
		today := absenceMapDay
		absenceType, err := repo.CreateStaffAbsenceType(ctx, workforce.StaffAbsenceTypeFields{
			Name:     "Regenerationstag",
			BaseType: workforce.AbsenceTypeOther,
			IsActive: true,
		})
		require.NoError(t, err)

		customAbsence := workforce.StaffAbsence{
			StaffID:       ident.ID(staff1.ID),
			AbsenceType:   workforce.AbsenceTypeOther,
			AbsenceTypeID: (*ident.ID)(&absenceType.ID),
			DateStart:     today.String(),
			DateEnd:       today.String(),
			Status:        workforce.AbsenceStatusApproved,
			CreatedBy:     ident.ID(staff1.ID),
		}
		standardAbsence := workforce.StaffAbsence{
			StaffID:     ident.ID(staff1.ID),
			AbsenceType: workforce.AbsenceTypeOther,
			DateStart:   today.String(),
			DateEnd:     today.String(),
			Status:      workforce.AbsenceStatusApproved,
			CreatedBy:   ident.ID(staff1.ID),
		}
		_, err = repo.CreateStaffAbsence(ctx, &customAbsence)
		require.NoError(t, err)
		_, err = repo.CreateStaffAbsence(ctx, &standardAbsence)
		require.NoError(t, err)

		absenceMap, err := repo.StaffAbsenceMapForDate(ctx, today.String())
		require.NoError(t, err)
		typeIDMap, err := repo.StaffAbsenceTypeIDMapForDate(ctx, today.String())
		require.NoError(t, err)

		assert.Equal(t, workforce.AbsenceTypeOther, absenceMap[staff1.ID])
		assert.Equal(t, absenceType.ID, typeIDMap[staff1.ID])
	})
}
