//go:build !linux

// Package exchange swaps a staged file with an existing object in one step,
// so a replacement never re-creates an object that was removed meanwhile.
package exchange

import "os"

// Files moves the staged file over the object and leaves an empty file under
// the staged name. Outside Linux there is no atomic exchange: a removal
// between the check and the rename re-creates the object. Production runs on
// Linux.
func Files(staged, object string) error {
	if _, err := os.Stat(object); err != nil {
		return err
	}
	if err := os.Rename(staged, object); err != nil {
		return err
	}
	file, err := os.OpenFile(staged, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	return file.Close()
}
