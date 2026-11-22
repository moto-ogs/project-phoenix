package compose_test

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

type stopAuditCounter struct{ calls atomic.Int64 }

func (a *stopAuditCounter) RecordRoomHistoryStop(context.Context, studentpresence.RoomHistoryStopEvent) error {
	a.calls.Add(1)
	return nil
}

func TestConcurrentRoomHistoryStopsPreserveTheFirstStop(t *testing.T) {
	t.Parallel()
	db := lockScenarioDB(t)
	ctx := testpkg.Ctx(t)
	module := newRevisionModule(t, db)
	audit := &stopAuditCounter{}
	stops := module.(studentpresence.RoomHistoryStopOwner).RoomHistoryStops(audit)
	student := testpkg.CreateTestStudent(t, db, "Concurrent", "Stop", "3a")
	change := studentpresence.RoomHistoryStopChange{
		StudentID: student.ID,
		Actor: studentpresence.RoomHistoryStopActor{
			AccountID: 1, Name: "Administration", Source: studentpresence.RoomHistoryStopSourceTenantPortal,
		},
	}
	holder := startTx(t, ctx, db)
	var first, second studentpresence.RoomHistoryStopResult
	awaitStep(t, holder.run(func(txCtx context.Context) error {
		var err error
		first, err = stops.StopRoomHistory(txCtx, change)
		return err
	}))
	waiter := startTx(t, ctx, db)
	waiting := waiter.run(func(txCtx context.Context) error {
		var err error
		second, err = stops.StopRoomHistory(txCtx, change)
		return err
	})
	awaitBlockedBy(t, db, waiter, holder)
	holder.commit(t)
	awaitStep(t, waiting)
	waiter.commit(t)
	require.True(t, first.Changed)
	require.False(t, second.Changed)
	require.True(t, first.StoppedAt.Equal(second.StoppedAt))
	require.Zero(t, second.DeletedVisits)
	require.EqualValues(t, 1, audit.calls.Load(), "a concurrent duplicate must not create another audit event")
}
