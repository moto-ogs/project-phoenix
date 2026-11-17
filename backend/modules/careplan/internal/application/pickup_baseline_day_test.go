package application

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// recordingBaselineSource records the window the booked-weekday read asks
// for and holds no bookings.
type recordingBaselineSource struct {
	from, to calendar.Date
}

func (s *recordingBaselineSource) ListApprovedByStudentIDsInRange(_ context.Context, _ []int64, from, to calendar.Date) ([]*careplan.ApprovedBooking, error) {
	s.from, s.to = from, to
	return nil, nil
}
func (s *recordingBaselineSource) BookingsAuthoritative(context.Context) (bool, error) {
	return false, nil
}
func (s *recordingBaselineSource) OfferingRows(context.Context, []*careplan.ApprovedBooking) (map[int64]*careplan.CareOffering, error) {
	return map[int64]*careplan.CareOffering{}, nil
}
func (s *recordingBaselineSource) StoredPickupRows(context.Context, []int64) ([]*careplan.PickupSchedule, error) {
	return nil, nil
}

// A booked offering manages a weekday from the school day of the
// composition on, not from the wall clock's day (ADR 0277).
func TestHasBookedOfferingPickupForWeekdayReadsFromTheComposedDay(t *testing.T) {
	t.Parallel()
	day := calendar.NewDate(2031, time.June, 2)
	source := &recordingBaselineSource{}
	queries := NewPickupBaselineQueries(source, func() calendar.Date { return day })

	managed, err := queries.HasBookedOfferingPickupForWeekday(context.Background(), 7, 1)

	require.NoError(t, err)
	assert.False(t, managed)
	assert.Equal(t, day, source.from, "the window starts on the composition's day")
	assert.Equal(t, calendar.NewDate(9999, time.December, 31), source.to)
}

func TestPickupBaselineQueriesRefuseAMissingDayClock(t *testing.T) {
	t.Parallel()
	assert.Panics(t, func() { NewPickupBaselineQueries(&recordingBaselineSource{}, nil) })
}
