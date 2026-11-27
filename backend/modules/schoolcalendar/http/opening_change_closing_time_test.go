package staffcalendarhttp_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The closing time of a day comes from the changes the school wrote over the
// route (#8157): the earliest of overlapping changes, none on a day without
// one, and never one of another school.
func TestOpeningChangeClosingTimeOfTheDay(t *testing.T) {
	t.Parallel()
	f := newOpeningChangeFixture(t)
	f.create(t, "2031-01-17", "Zeugnisausgabe") // closes 12:00
	rec := f.do(t, f.school, http.MethodPost, openingChangesPath, map[string]any{
		"start_date": "2031-01-13", "end_date": "2031-01-17", "opens_at": "07:00", "closes_at": "14:45", "reason": "Projektwoche",
	}, permissions.SchedulesCreate)
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	closingTime := func(t *testing.T, school int64, day calendar.Date) (string, bool) {
		t.Helper()
		var closesAt string
		var ok bool
		require.NoError(t, testpkg.WithinTenantContext(t, testpkg.Ctx(t), testpkg.SetupTestDB(t), school, func(txCtx context.Context) error {
			var err error
			closesAt, ok, err = schoolCalendarCompose.NewOpeningChanges().ClosingTimeOn(txCtx, day)
			return err
		}))
		return closesAt, ok
	}

	closesAt, ok := closingTime(t, f.school, calendar.NewDate(2031, time.January, 17))
	assert.True(t, ok)
	assert.Equal(t, "12:00", closesAt, "the earliest of two overlapping changes wins")
	closesAt, ok = closingTime(t, f.school, calendar.NewDate(2031, time.January, 14))
	assert.True(t, ok)
	assert.Equal(t, "14:45", closesAt)
	_, ok = closingTime(t, f.school, calendar.NewDate(2031, time.January, 18))
	assert.False(t, ok, "a day without a change keeps the regular hours")

	t.Run("andere Schule", func(t *testing.T) {
		testpkg.OwnTenant(t)
		_, ok := closingTime(t, testpkg.Tenant(t), calendar.NewDate(2031, time.January, 17))
		assert.False(t, ok, "the changes of one school never reach another")
	})
}
