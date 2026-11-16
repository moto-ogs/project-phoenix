package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"syscall"
	"time"
)

// traegerLockPoll is how often a seed waiting for the Träger lock tries again.
const traegerLockPoll = 20 * time.Millisecond

// fileTraegerLock serializes the Träger steps of seed processes that name the
// same file (#6962). The seed smoke seeds two demo schools under one Träger
// side by side; the Träger steps read and then write state of the whole
// Träger, which the lock of one process does not cover across two. The lock
// is flock(2) on that file: it ends with the process, so a crashed seed
// leaves no stale lock behind.
func fileTraegerLock(path string) func(context.Context) (func(), error) {
	return func(ctx context.Context) (func(), error) {
		file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
		if err != nil {
			return nil, fmt.Errorf("open the Träger lock %s: %w", path, err)
		}
		for {
			err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
			if err == nil {
				// Unlock before closing: a subprocess forked meanwhile
				// shares the lock until it execs (#7216).
				return func() {
					_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
					_ = file.Close()
				}, nil
			}
			if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EINTR) {
				_ = file.Close()
				return nil, fmt.Errorf("lock the Träger lock %s: %w", path, err)
			}
			select {
			case <-ctx.Done():
				_ = file.Close()
				return nil, ctx.Err()
			case <-time.After(traegerLockPoll):
			}
		}
	}
}
