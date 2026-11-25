package care

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ChildDayChanges is the port of "Heute anders" for one child (#7671): what
// is different today for the child, read in the child's school. The root
// binds it to the day changes projection (ADR 0299). The port's vocabulary
// has no field for a staff member's name and none for a free text of the
// school besides the name of a closing day; the parents portal cannot leak
// what it cannot carry.
type ChildDayChanges interface {
	ChildDayChanges(ctx context.Context, studentID, accountID int64) (ChildDay, error)
}

// ChildDay is the day of one child: the school's calendar day, the state of
// every source and the changes in the projection's order.
type ChildDay struct {
	Date    calendar.Date
	Sources []ChildDaySource
	Entries []ChildDayChange
}

// ChildDaySource reports one source; Failed means its changes are missing.
type ChildDaySource struct {
	Source string
	Failed bool
}

// ChildDayChange is one change to the child's regular day. Kind names it;
// the other fields are set only where the kind uses them.
type ChildDayChange struct {
	Kind string
	// AllDay is true for a change without a time of day.
	AllDay bool
	// Since and Until are set where a change reaches past today.
	Since, Until *calendar.Date
	// StartsAt and EndsAt are the instants of a block.
	StartsAt, EndsAt *time.Time
	// EnteredByYou marks a change the reading guardian entered itself.
	EnteredByYou bool
	// ChildStatus is "sick" or "excused" on child_absent.
	ChildStatus *string
	// PickupTime is the changed pickup ("15:04"); nil on
	// child_pickup_changed means the child does not come.
	PickupTime *string
	// ActivityTitle, RoomName and PreviousRoomName describe a block.
	ActivityTitle    *string
	RoomName         *string
	PreviousRoomName *string
	// ClosingName is the school's or the Träger's name of a closing day.
	ClosingName    *string
	ClosingTraeger bool
	// ClassName and ClassTime describe a class trip (return time) or a
	// changed Unterrichtsschluss.
	ClassName *string
	ClassTime *string
}

// ErrDayChangesUnavailable reports a composition without the day changes.
var ErrDayChangesUnavailable = errors.New("parent: day changes capability is required")

// GetChildDayChanges reads "Heute anders" of a child the guardian may see
// (parent_portal.access). Revoking the permission ends the read; another
// school's child is no child of the account.
func (s *Service) GetChildDayChanges(ctx context.Context, accountID, studentID int64) (ChildDay, error) {
	child, err := s.ResolvePermittedChild(ctx, accountID, studentID, GuardianPermissionPortalAccess)
	if err != nil {
		return ChildDay{}, err
	}
	if s.DayChanges == nil {
		return ChildDay{}, ErrDayChangesUnavailable
	}
	var day ChildDay
	txErr := s.Runtime.WithinTenant(ctx, child.TenantID, func(txCtx context.Context) error {
		read, readErr := s.DayChanges.ChildDayChanges(txCtx, studentID, accountID)
		day = read
		return readErr
	})
	if txErr != nil {
		return ChildDay{}, fmt.Errorf("parent: child day changes: %w", txErr)
	}
	return day, nil
}
