package grouplive

import (
	"context"
	"fmt"
	"time"
)

// careDayEnd resolves the school's care day end on first need. On a day
// with changed opening hours it is the changed closing time (#8157), which
// costs a statement; only a child in class or one expected without a pickup
// time depends on it, so a roster without such a child never reads it.
type careDayEnd struct {
	resolve func() (string, error)
	value   string
	err     error
	done    bool
}

func (s *service) lazyCareDayEnd(ctx context.Context) *careDayEnd {
	return &careDayEnd{resolve: func() (string, error) { return s.deps.Settings.CareDayEnd(ctx) }}
}

func (c *careDayEnd) get() string {
	if !c.done {
		c.done = true
		c.value, c.err = c.resolve()
	}
	return c.value
}

// failure is the error of the read, if one ran and failed.
func (c *careDayEnd) failure() error {
	if c.err != nil {
		return fmt.Errorf("resolve care day end: %w", c.err)
	}
	return nil
}

// atSchoolCareDayEnd is the care day end the "Schule" rule reads: only for
// an expected child without check-in and pickup time does it decide anything.
func atSchoolCareDayEnd(end *careDayEnd, decision DayDecision, checkedIn bool, pickupTime *time.Time) string {
	if !decision.ComesToday || checkedIn || pickupTime != nil {
		return ""
	}
	return end.get()
}
