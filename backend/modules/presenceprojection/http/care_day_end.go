package presenceprojectionhttp

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ClosingTimes answers the closing time "HH:MM" a changed opening day sets
// for the school of the tenant transaction (#8157); ok is false on a day
// without one. The root binds the School Calendar.
type ClosingTimes func(ctx context.Context, day calendar.Date) (closesAt string, ok bool, err error)

// careDayEnd resolves today's care day end on first need: the closing time
// of a changed opening day (#8157), otherwise operations.session_end_time.
// The closing time costs a statement, and only a child in class or one
// expected without a pickup time depends on it.
type careDayEnd struct {
	resolve func() (string, error)
	value   string
	err     error
	done    bool
}

func (rs *Resource) lazyCareDayEnd(ctx context.Context) *careDayEnd {
	return &careDayEnd{resolve: func() (string, error) { return rs.careDayEndToday(ctx) }}
}

func (c *careDayEnd) get() string {
	if !c.done {
		c.done = true
		c.value, c.err = c.resolve()
	}
	return c.value
}

func (rs *Resource) careDayEndToday(ctx context.Context) (string, error) {
	if rs.ClosingTimes != nil {
		closesAt, ok, err := rs.ClosingTimes(ctx, calendar.DateFromTime(rs.Now()))
		if err != nil {
			return "", fmt.Errorf("read the closing time of today: %w", err)
		}
		if ok {
			return closesAt, nil
		}
	}
	return rs.SettingsService.ResolveString(ctx, settingSessionEndTime)
}
