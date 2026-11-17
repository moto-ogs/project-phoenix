package presence

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RequestRuntime binds request identity, rollback handling and the clock to
// the HTTP runtime. Now is the composition's clock (ADR 0239): the day the
// supervision reads name and the instants the responses compare with.
type RequestRuntime struct {
	WithStaff    func(context.Context, int64, int64) context.Context
	TenantID     func(context.Context) int64
	MarkRollback func(context.Context)
	Now          func() time.Time
}

// now reads the runtime's clock, which NewResource requires.
func (rs *Resource) now() time.Time {
	return rs.runtime.Now()
}

func (rs *Resource) today() calendar.Date { return calendar.DateFromTime(rs.now()) }
