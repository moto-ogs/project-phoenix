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
//
// day is the day to read: nil reads the school's today, any other day must
// be today or tomorrow of the school, else the port answers
// ErrDayChangesDayOutOfRange (#8236).
type ChildDayChanges interface {
	ChildDayChanges(ctx context.Context, studentID, accountID int64, day *calendar.Date) (ChildDay, error)
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
	// PickupPersonName is who collects the child today on
	// child_pickup_person (#8162); PickupPersonOneTime marks a person who
	// shows an ID card at the pickup.
	PickupPersonName    *string
	PickupPersonOneTime bool
	// PickupAfterClosing marks a changed pickup after today's changed
	// closing time (#8170).
	PickupAfterClosing bool
	// ActivityTitle, RoomName and PreviousRoomName describe a block.
	ActivityTitle    *string
	RoomName         *string
	PreviousRoomName *string
	// ClosingName is the school's or the Träger's name of a closing day.
	ClosingName    *string
	ClosingTraeger bool
	// OpeningName, OpensAt and ClosesAt describe an opening change of the
	// school ("13:00"), #8170.
	OpeningName *string
	OpensAt     *string
	ClosesAt    *string
	// ClassName and ClassTime describe a class trip (return time) or a
	// changed Unterrichtsschluss.
	ClassName *string
	ClassTime *string
}

// ErrDayChangesUnavailable reports a composition without the day changes.
var ErrDayChangesUnavailable = errors.New("parent: day changes capability is required")

// ErrDayChangesDayOutOfRange reports a day other than today or tomorrow of
// the child's school (#8236).
var ErrDayChangesDayOutOfRange = errors.New("parent: day changes read only today and tomorrow")

// GetChildDayChanges reads "Heute anders" of a child with an OGS place the
// guardian may see (parent_portal.access). The relationship authorization and
// tenant-scoped read share one transaction, so a revoked permission cannot
// authorize a later read. A nil day reads today; tomorrow is the preview
// with the same rules (#8236). The relationship is checked before the day.
func (s *Service) GetChildDayChanges(ctx context.Context, accountID, studentID int64, day *calendar.Date) (ChildDay, error) {
	var result ChildDay
	err := s.WithPermittedChild(ctx, accountID, studentID, GuardianPermissionPortalAccess, func(child *Child) error {
		if err := child.RequireCarePlace(); err != nil {
			return err
		}
		if s.DayChanges == nil {
			return ErrDayChangesUnavailable
		}
		return nil
	}, func(txCtx context.Context, _ *Child) error {
		read, readErr := s.DayChanges.ChildDayChanges(txCtx, studentID, accountID, day)
		result = read
		return readErr
	})
	if err != nil {
		return ChildDay{}, fmt.Errorf("parent: child day changes: %w", err)
	}
	return result, nil
}
