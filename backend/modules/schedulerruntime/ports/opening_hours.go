package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ClosingTimes answers the closing time "HH:MM" a changed opening day sets
// for the school of the tenant transaction (#8157); ok is false on a day
// without one. It replaces operations.session_end_time on that day. The root
// binds the School Calendar.
type ClosingTimes func(ctx context.Context, day calendar.Date) (closesAt string, ok bool, err error)
