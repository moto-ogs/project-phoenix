package application

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// closureLockStore records which closure read protects a room-using write.
// It embeds the regular room seam because Closures shares the room service's
// store and transaction.
type closureLockStore struct {
	seamStore
	lockedFilter facilities.RoomClosureFilter
	lockedCalls  int
	plainCalls   int
	closures     []facilities.RoomClosure
}

func (*closureLockStore) InsertClosure(context.Context, facilities.CloseRoom) (facilities.RoomClosure, domain.OperationStats, error) {
	return facilities.RoomClosure{}, domain.OperationStats{}, nil
}

func (*closureLockStore) DeleteClosure(context.Context, int64, int64) (bool, domain.OperationStats, error) {
	return false, domain.OperationStats{}, nil
}

func (s *closureLockStore) ListClosures(_ context.Context, _ facilities.RoomClosureFilter) ([]facilities.RoomClosure, domain.OperationStats, error) {
	s.plainCalls++
	return s.closures, domain.OperationStats{}, nil
}

func (s *closureLockStore) ListClosuresWithRoomLocks(_ context.Context, filter facilities.RoomClosureFilter) ([]facilities.RoomClosure, domain.OperationStats, error) {
	s.lockedCalls++
	s.lockedFilter = filter
	return s.closures, domain.OperationStats{}, nil
}

func TestRoomClosedOnUsesRoomLockingRead(t *testing.T) {
	t.Parallel()

	day := calendar.NewDate(2026, 11, 26)
	store := &closureLockStore{closures: []facilities.RoomClosure{{RoomID: 47, StartDate: day, EndDate: day}}}
	service := NewRooms(store, seamTransaction{}, func(domain ports.Observation) {})
	closures := NewClosures(service, store, func() calendar.Date { return day })

	closed, err := closures.RoomClosedOn(testpkg.TenantContext(47), 47, day)

	require.NoError(t, err)
	assert.True(t, closed)
	assert.Equal(t, 1, store.lockedCalls)
	assert.Zero(t, store.plainCalls)
	assert.Equal(t, []int64{47}, store.lockedFilter.RoomIDs)
	assert.Equal(t, day, store.lockedFilter.From)
	assert.Equal(t, day, store.lockedFilter.Until)
}
