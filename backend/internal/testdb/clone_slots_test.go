package testdb

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestTmpfsSizeMBReadsTheMountOfTheDataDirectory(t *testing.T) {
	t.Parallel()
	const mountinfo = `819 700 0:99 / / rw,relatime - overlay overlay rw,lowerdir=/l
830 819 0:113 / /dev/shm rw,nosuid - tmpfs shm rw,size=65536k,inode64
831 819 0:114 / /var/lib/postgresql/data rw,nosuid,nodev,noexec,relatime - tmpfs tmpfs rw,size=2621440k,inode64,huge=advise
`
	assert.Equal(t, 2560, tmpfsSizeMB(mountinfo, "/var/lib/postgresql/data"))
	assert.Equal(t, 2560, tmpfsSizeMB(mountinfo, "/var/lib/postgresql/data/pgdata"))
	assert.Zero(t, tmpfsSizeMB(mountinfo, "/var/lib/postgresql/other"), "a data directory on the container disk is not limited")
	assert.Zero(t, tmpfsSizeMB(mountinfo, "/var/lib/postgresql/database"), "a sibling path is not inside the tmpfs")
	assert.Zero(t, tmpfsSizeMB("", "/var/lib/postgresql/data"))
}

// A clone waits for a slot instead of filling the server (#7860), and a
// dropped clone or a dead binary hands its slot on.
func TestCreateCloneWaitsForACloneSlot(t *testing.T) {
	t.Parallel()
	cfg := integrationConfig(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	builds := 0
	templateCfg, err := EnsureTemplate(ctx, cfg, WithBuild(fakeBuild(&builds)), WithMigrationsHash("cloneslots"))
	require.NoError(t, err)

	// One slot, in a lock class of its own: the suite around this test holds
	// slots of the real class on the same server.
	open := func() *Maintenance {
		maint := OpenMaintenance(templateCfg)
		maint.slots = cloneSlots{class: cloneSlotLockClass + int32(os.Getpid()), limit: 1, resolved: true}
		t.Cleanup(func() { _ = maint.close() })
		return maint
	}
	create := func(maint *Maintenance, wait time.Duration) (*CloneHandle, error) {
		waitCtx, cancelWait := context.WithTimeout(ctx, wait)
		defer cancelWait()
		handle, err := maint.CreateShortLivedClone(waitCtx, templateCfg, SanitizeRunID(""))
		if handle != nil {
			t.Cleanup(func() {
				_ = handle.Close()
				dropBareClone(t, cfg, handle.Name)
			})
		}
		return handle, err
	}

	first, second := open(), open()
	held, err := create(first, time.Minute)
	require.NoError(t, err)

	_, err = create(second, 300*time.Millisecond)
	require.ErrorIs(t, err, context.DeadlineExceeded, "the second binary must wait while the only slot is taken")
	_, err = create(first, 300*time.Millisecond)
	require.ErrorIs(t, err, context.DeadlineExceeded, "a session must not take its own slot twice")

	require.NoError(t, held.Close())
	require.NoError(t, first.DropClone(ctx, held.Name))
	_, err = create(second, time.Minute)
	require.NoError(t, err, "dropping a clone frees its slot")

	// The second binary dies with its clone alive: the slot is free at once.
	require.NoError(t, second.close())
	_, err = create(first, time.Minute)
	require.NoError(t, err, "a dead slot session frees its slots")
}

// A full tmpfs (SQLSTATE 53100) recovers without a hand: the failed clone
// drops what no live binary protects and tries once more (#7860).
func TestCreateCloneRetriesAfterDiskFullOnceDeadClonesAreGone(t *testing.T) {
	t.Parallel()
	cfg := integrationConfig(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	builds := 0
	templateCfg, err := EnsureTemplate(ctx, cfg, WithBuild(fakeBuild(&builds)), WithMigrationsHash("cloneslots"))
	require.NoError(t, err)

	// Of this very run: a worktree's earlier, killed run shares its run ID.
	killed := ClonePrefix + RunID() + "_" + SanitizeRunID("")
	createBareClone(t, ctx, cfg, killed)
	t.Cleanup(func() { dropBareClone(t, cfg, killed) })

	maint := OpenMaintenance(templateCfg)
	t.Cleanup(func() { _ = maint.close() })
	attempts := 0
	_, err = maint.retryAfterDiskFull(ctx, templateCfg, func() (*CloneHandle, error) {
		attempts++
		if attempts == 1 {
			return nil, fmt.Errorf("clone test database: %w", pgdriver.NewError(map[byte]string{'C': "53100"}))
		}
		return nil, nil
	})
	require.NoError(t, err)
	assert.Equal(t, 2, attempts)
	assert.False(t, databaseExists(t, ctx, cfg, killed), "the retry must first drop the clone no binary holds")

	other := errors.New("template is gone")
	_, err = maint.retryAfterDiskFull(ctx, templateCfg, func() (*CloneHandle, error) { return nil, other })
	require.ErrorIs(t, err, other, "any other failure is reported, not retried")
}
