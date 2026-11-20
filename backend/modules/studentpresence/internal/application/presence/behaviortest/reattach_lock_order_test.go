package behaviortest_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type stayRowHolder struct {
	pid         int
	release     chan struct{}
	releaseOnce sync.Once
	done        chan struct{}
	err         error
}

func holdStayRow(t *testing.T, db *bun.DB, stayID int64) *stayRowHolder {
	t.Helper()
	holder := &stayRowHolder{release: make(chan struct{}), done: make(chan struct{})}
	t.Cleanup(func() { holder.commit(t) })
	ready := make(chan int, 1)
	go func() {
		defer close(holder.done)
		holder.err = testpkg.WithTenantTx(t, testpkg.Ctx(t), db, testpkg.Tenant(t), func(txCtx context.Context, tx bun.Tx) error {
			var pid int
			if err := tx.NewRaw("SELECT pg_backend_pid()").Scan(txCtx, &pid); err != nil {
				return err
			}
			var locked int64
			if err := tx.NewRaw("SELECT id FROM active.groups WHERE id = ? FOR UPDATE", stayID).Scan(txCtx, &locked); err != nil {
				return err
			}
			ready <- pid
			<-holder.release
			return nil
		})
	}()
	select {
	case holder.pid = <-ready:
	case <-holder.done:
		t.Fatalf("stay holder did not start: %v", holder.err)
	}
	return holder
}

func (h *stayRowHolder) commit(t *testing.T) {
	t.Helper()
	h.releaseOnce.Do(func() { close(h.release) })
	select {
	case <-h.done:
		require.NoError(t, h.err)
	case <-time.After(10 * time.Second):
		t.Fatal("stay holder did not commit")
	}
}

// awaitBlockedOn returns a backend other than except that waits on a lock the
// holder pid or except holds.
func awaitBlockedOn(t *testing.T, db *bun.DB, holderPID, except int) int {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var waiters []int
		require.NoError(t, db.NewRaw(`SELECT pid FROM pg_stat_activity
 WHERE pid <> ?::int AND (?::int = ANY (pg_blocking_pids(pid)) OR ?::int = ANY (pg_blocking_pids(pid)))`,
			except, holderPID, except).Scan(context.Background(), &waiters))
		if len(waiters) > 0 {
			return waiters[0]
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("no backend waited on the holder")
	return 0
}

func awaitResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(15 * time.Second):
		t.Fatal("writer did not finish")
		return nil
	}
}

func TestStayRowHolderCleanupReleasesTransaction(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	room := testpkg.CreateTestRoom(t, db, "Stay holder cleanup")
	activity := testpkg.CreateTestActivityGroup(t, db, "Stay holder cleanup")
	stay := testpkg.CreateTestActiveGroup(t, db, activity.ID, room.ID)
	var holder *stayRowHolder
	t.Run("without explicit commit", func(t *testing.T) {
		holder = holdStayRow(t, db, stay.ID)
	})
	defer holder.commit(t)
	select {
	case <-holder.done:
	default:
		t.Fatal("cleanup did not finish the holder transaction")
	}
	holder.commit(t)
}
