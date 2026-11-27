package ports

import "context"

// SettingsSnapshot is an opaque handle on one school's settings, resolved
// ahead of a tick. Only the source that resolved it can bind it.
type SettingsSnapshot any

// Settings is the Worker's per-key resolver and required batch read. The
// root binds the Settings Platform's cross-tenant read, which the active
// and cleanup loops each share per minute. A missing snapshot fails its
// school's tick.
type Settings interface {
	SettingsResolver

	ResolveSettingsSnapshots(ctx context.Context, tenantIDs []int64, keys []string) (map[int64]SettingsSnapshot, error)
	// BindSettingsSnapshot returns a context whose settings reads the
	// snapshot serves, including the reads of the owners a job calls. A
	// snapshot it did not resolve is an error, never a silent database read.
	BindSettingsSnapshot(ctx context.Context, snapshot SettingsSnapshot) (context.Context, error)
}
