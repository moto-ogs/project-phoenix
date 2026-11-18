package settings

import "context"

// ClassListConversionLock is the shared side of the lock both switches of
// the class-list conversion take (#4803, ADR 0283). A class-list write takes
// it before it reads the switches and keeps it to commit, so a switch that
// turns the conversion on either waits for the write's entries or is seen
// by it. Best-effort without an ambient transaction, like every lock helper.
type ClassListConversionLock interface {
	LockClassListConversionShared(ctx context.Context) error
}
