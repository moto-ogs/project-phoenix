package compose

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type closureReadResult struct {
	closed bool
	err    error
}

// A closure inserted while a room-using write waits for the room lock must be
// visible after that wait. The old single lock-and-read statement kept its
// snapshot from before the wait and incorrectly returned an open room.
func TestRoomClosureReadRefreshesAfterWaitingForClose(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	today := calendar.NewDate(2026, time.November, 26)
	closures, err := NewClosures(Dependencies{
		DB: db, Observe: func(Observation) {}, Now: today.BerlinMidnight,
	})
	require.NoError(t, err)
	room := testpkg.CreateTestRoom(t, db, "Sperr-Parallelraum")

	closerPID := make(chan int, 1)
	closureInserted := make(chan struct{})
	releaseClose := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(releaseClose) }) })
	closeDone := make(chan error, 1)
	go func() {
		closeDone <- testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
			var pid int
			if err := tx.NewRaw("SELECT pg_backend_pid()").Scan(ctx, &pid); err != nil {
				return err
			}
			closerPID <- pid
			if _, err := closures.CloseRoom(ctx, facilities.CloseRoom{
				RoomID: room.ID, StartDate: today, EndDate: today, Reason: "Reinigung",
			}); err != nil {
				return err
			}
			close(closureInserted)
			<-releaseClose
			return nil
		})
	}()

	holderPID := <-closerPID
	select {
	case <-closureInserted:
	case err := <-closeDone:
		require.NoError(t, err, "the closer must hold its room lock")
		return
	}

	readerPID := make(chan int, 1)
	readDone := make(chan closureReadResult, 1)
	go func() {
		result := closureReadResult{}
		result.err = testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(ctx context.Context, tx bun.Tx) error {
			var pid int
			if err := tx.NewRaw("SELECT pg_backend_pid()").Scan(ctx, &pid); err != nil {
				return err
			}
			readerPID <- pid
			closed, err := closures.RoomClosedOn(ctx, room.ID, today)
			result.closed = closed
			return err
		})
		readDone <- result
	}()

	waitForClosureReaderBlock(t, db, holderPID, <-readerPID, readDone)
	releaseOnce.Do(func() { close(releaseClose) })
	require.NoError(t, <-closeDone)
	result := <-readDone
	require.NoError(t, result.err)
	require.True(t, result.closed, "the reader must see the closure committed while it waited")
}

func waitForClosureReaderBlock(t *testing.T, db *bun.DB, holderPID, readerPID int, done <-chan closureReadResult) {
	t.Helper()
	poll := time.NewTicker(10 * time.Millisecond)
	defer poll.Stop()
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); {
		var blocked bool
		require.NoError(t, db.NewRaw(`SELECT ?::int = ANY(pg_blocking_pids(?::int))`, holderPID, readerPID).Scan(context.Background(), &blocked))
		if blocked {
			return
		}
		select {
		case result := <-done:
			require.FailNow(t, "closure reader finished instead of waiting", "%v", result.err)
		case <-poll.C:
		}
	}
	require.FailNow(t, "closure reader never waited for the closer")
}
