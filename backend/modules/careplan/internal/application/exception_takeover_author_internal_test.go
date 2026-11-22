package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Taking over a day a guardian set names its new author through the
// resolver: (0, nil) is a caller without a staff record, an error a failed
// lookup (#7818). Only the missing author is refused; the failed lookup stays
// the failure, so the route answers 500 and not a misleading 403.
func TestExceptionTakeoverAuthorKeepsLookupFailures(t *testing.T) {
	t.Parallel()

	const studentID int64 = 7
	const guardianAccountID int64 = 8
	const staffID int64 = 9
	day := calendar.NewDate(2026, 9, 9)
	guardianID := guardianAccountID
	resolver := func(id int64, err error) func() (int64, error) {
		return func() (int64, error) { return id, err }
	}
	guardianDay := func() domain.EffectiveExceptionFields {
		return domain.EffectiveExceptionFields{StudentID: studentID, Date: day, Source: careplan.ExceptionSourceGuardian, CreatedByGuardian: &guardianID}
	}
	traeger := careplan.WithTraegerBueroAuthor(context.Background())

	t.Run("update", func(t *testing.T) {
		t.Parallel()
		fields := guardianDay()
		err := prepareExceptionUpdate(context.Background(), &fields, studentID, day, false, resolver(0, errBoom))
		require.ErrorIs(t, err, errBoom)
		require.NotErrorIs(t, err, careplan.ErrCareExceptionStaffProfileRequired)

		fields = guardianDay()
		require.ErrorIs(t, prepareExceptionUpdate(context.Background(), &fields, studentID, day, false, resolver(0, nil)),
			careplan.ErrCareExceptionStaffProfileRequired)

		fields = guardianDay()
		require.NoError(t, prepareExceptionUpdate(traeger, &fields, studentID, day, false, resolver(0, nil)))
		assert.Equal(t, careplan.ExceptionSourceStaff, fields.Source)
		assert.Zero(t, fields.CreatedBy)
		assert.True(t, fields.EnteredByTraeger)
		assert.Nil(t, fields.CreatedByGuardian)

		fields = guardianDay()
		require.NoError(t, prepareExceptionUpdate(traeger, &fields, studentID, day, false, resolver(staffID, nil)))
		assert.Equal(t, staffID, fields.CreatedBy, "a staff member writes as staff, also in a Träger session")
		assert.False(t, fields.EnteredByTraeger)
	})

	t.Run("reclaim", func(t *testing.T) {
		t.Parallel()
		core := &effectiveTimeCore[*careplan.PickupSchedule, *careplan.PickupException, *careplan.PickupNote, PickupTimeDomain]{}
		existing := &careplan.PickupException{StudentID: studentID, ExceptionDate: careplan.Date(day), Source: careplan.ExceptionSourceGuardian, CreatedByGuardian: &guardianID}
		_, err := core.reclaimedFields(context.Background(), existing, domain.EffectiveExceptionFields{}, resolver(0, errBoom))
		require.ErrorIs(t, err, errBoom)
		require.NotErrorIs(t, err, careplan.ErrCareExceptionStaffProfileRequired)

		_, err = core.reclaimedFields(context.Background(), existing, domain.EffectiveExceptionFields{}, resolver(0, nil))
		require.ErrorIs(t, err, careplan.ErrCareExceptionStaffProfileRequired)

		fields, err := core.reclaimedFields(traeger, existing, domain.EffectiveExceptionFields{}, resolver(0, nil))
		require.NoError(t, err)
		assert.Zero(t, fields.CreatedBy)
		assert.True(t, fields.EnteredByTraeger)
	})
}
