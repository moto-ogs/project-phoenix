//go:build linux

// Package exchange swaps a staged file with an existing object in one step,
// so a replacement never re-creates an object that was removed meanwhile.
package exchange

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// Files swaps the staged file and the object (renameat2 RENAME_EXCHANGE).
// It fails with os.ErrNotExist when the object is gone.
func Files(staged, object string) error {
	err := unix.Renameat2(unix.AT_FDCWD, staged, unix.AT_FDCWD, object, unix.RENAME_EXCHANGE)
	if errors.Is(err, unix.ENOENT) {
		return os.ErrNotExist
	}
	return err
}
