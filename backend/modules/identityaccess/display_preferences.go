package identityaccess

import "context"

// DisplayPreferences are a person's own display choices that hold in every
// portal. MoreContrast is nil while the person has not decided; the browser
// then follows the device's prefers-contrast.
type DisplayPreferences struct {
	MoreContrast *bool
}

// DisplayPreferenceHolder names whose preferences are read or written. An
// operator is no account: operator IDs are a space of their own
// (platform.operators), so the holder states which one it is.
type DisplayPreferenceHolder struct {
	Operator bool
	ID       int64
}

// AccountDisplayPreferences reads and records the display preferences of the
// authenticated person itself. The caller authorizes the holder: only the
// subject of a real session decides for itself. A missing or erased account
// reports ErrAccountNotFound, a missing operator ErrOperatorNotFound. Both
// run on the global identity unit and join a caller's transaction; the
// preference belongs to the person, not to a school.
type AccountDisplayPreferences interface {
	FindDisplayPreferences(ctx context.Context, holder DisplayPreferenceHolder) (DisplayPreferences, error)
	// SetMoreContrast records the choice and returns the preferences as stored.
	SetMoreContrast(ctx context.Context, holder DisplayPreferenceHolder, moreContrast bool) (DisplayPreferences, error)
}
