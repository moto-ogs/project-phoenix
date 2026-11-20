package presence

import "context"

// Authorization supplies the Security Runtime policies used by active routes.
type Authorization struct {
	OperationalOverview func(context.Context, Settings, StaffAccess, bool, bool) (bool, error)
}
