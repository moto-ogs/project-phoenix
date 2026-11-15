package main

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Two seed processes that name the same lock file run their Träger steps one
// at a time (#6962). Each acquisition opens the file anew, as a second process
// does, so the second waits for the first to release it.
func TestFileTraegerLockHoldsOutASecondHolderUntilReleased(t *testing.T) {
	t.Parallel()

	lock := fileTraegerLock(filepath.Join(t.TempDir(), "traeger.lock"))
	release, err := lock(context.Background())
	require.NoError(t, err)

	acquired := make(chan func(), 1)
	go func() {
		second, err := lock(context.Background())
		if assert.NoError(t, err) {
			acquired <- second
		}
	}()
	assert.Never(t, func() bool { return len(acquired) > 0 }, 100*time.Millisecond, 5*time.Millisecond,
		"a second holder must wait while the first holds the lock")

	release()
	select {
	case second := <-acquired:
		second()
	case <-time.After(5 * time.Second):
		t.Fatal("the second holder did not get the lock after the first released it")
	}
}

func TestFileTraegerLockWaitEndsWithTheContext(t *testing.T) {
	t.Parallel()

	lock := fileTraegerLock(filepath.Join(t.TempDir(), "traeger.lock"))
	release, err := lock(context.Background())
	require.NoError(t, err)
	defer release()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err = lock(ctx)
	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestFileTraegerLockReportsAnUnopenableFile(t *testing.T) {
	t.Parallel()

	lock := fileTraegerLock(filepath.Join(t.TempDir(), "missing", "traeger.lock"))
	_, err := lock(context.Background())
	assert.ErrorContains(t, err, "open the Träger lock")
}
