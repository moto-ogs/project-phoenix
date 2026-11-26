package presence

import (
	"context"
)

// StaffAccess supplies the authenticated staff identity used by active routes.
type StaffAccess interface {
	GetCurrentStaff(context.Context) (*StaffIdentity, error)
}
