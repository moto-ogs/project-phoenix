package identityaccess

import (
	"context"
	"errors"
	"time"
)

// SpringerRoleName is the platform system role „Springer“ (#7173, ADR 0251):
// base role user, only time_tracking:own. The first block of a Springer at
// a school assigns it there.
const SpringerRoleName = "springer"

// ErrSpringerAccessWindowInvalid refuses a window that ends before it starts.
var ErrSpringerAccessWindowInvalid = errors.New("springer access window must end after it starts")

// SpringerWindow is one block of a Springer at the school of the caller's
// tenant transaction: the account it admits, the names a new person at the
// school carries, the block it comes from and the time it admits.
type SpringerWindow struct {
	AccountID int64
	FirstName string
	LastName  string
	// BlockID names the Vertretungspool block; one window per block.
	BlockID  int64
	StartsAt time.Time
	EndsAt   time.Time
}

// SpringerEmployment is the employment the window admits to.
type SpringerEmployment struct {
	PersonID int64
	StaffID  int64
}

// SpringerAccess gives a Springer access to a school only in the times a
// school blocked them (ADR 0251). Both commands join the caller's tenant
// transaction.
type SpringerAccess interface {
	// GrantSpringerWindow creates what is missing at the school: the
	// account's mapping; the system role springer, which admits only in
	// windows unless the account holds another role there; person and employment,
	// resuming a former employment (ADR 0021); and the window of the block.
	GrantSpringerWindow(ctx context.Context, window SpringerWindow) (SpringerEmployment, error)
	// EndSpringerWindow deletes the window of a lifted block; a block
	// without a window is no error.
	EndSpringerWindow(ctx context.Context, blockID int64) error
	// PruneSpringerWindows deletes the windows that have ended from every
	// mapping at the school (#7197).
	PruneSpringerWindows(ctx context.Context) error
	// HoldsOnlySpringerAccess reports whether the account's roles at the
	// school are the system role springer, besides guardian at most: the
	// school gave it no role of its own (#7197, ADR 0253).
	HoldsOnlySpringerAccess(ctx context.Context, accountID int64) (bool, error)
}
