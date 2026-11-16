package users

import "time"

// WithClock binds the composition's clock a new profile counts as childless
// from (#4043): Create stamps childless_since with it instead of leaving the
// column's NOW() default, so the retention run, which counts from the same
// clock, never sees a profile created under it as older than it is (ADR 0268).
// The real clock when unbound.
func WithClock(now func() time.Time) GuardianProfileOption {
	return func(r *guardianProfileRepository) {
		if now != nil {
			r.now = now
		}
	}
}
