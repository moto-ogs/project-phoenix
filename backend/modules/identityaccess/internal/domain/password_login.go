package domain

import "time"

// PasswordLoginState belongs to the identity, not its IP, portal or school.
// MFA code attempts have their own counter so a password cannot clear them.
// PasswordFailedAt is the time of the last wrong password: a failure older
// than the lock duration no longer counts (#7214).
type PasswordLoginState struct {
	PasswordAttempts    int
	PasswordLockedUntil *time.Time
	PasswordFailedAt    *time.Time
}
