package devicefleet

import (
	"context"
	"errors"
	"strings"
	"time"
)

// LifecycleAction names one effective change in a device's life
// (Gerätelebenszyklus, #2321).
type LifecycleAction string

// The lifecycle changes Device Fleet records. A transfer leaves one entry at
// the archived source device and one at the device of the target school;
// neither names the other school, so a school's history and its data
// export stay within the school.
const (
	LifecycleCreated        LifecycleAction = "created"
	LifecycleUpdated        LifecycleAction = "updated"
	LifecycleBlocked        LifecycleAction = "blocked"
	LifecycleUnblocked      LifecycleAction = "unblocked"
	LifecycleStatusChanged  LifecycleAction = "status_changed"
	LifecycleKeyRotated     LifecycleAction = "key_rotated"
	LifecycleRemoved        LifecycleAction = "removed"
	LifecycleTransferredOut LifecycleAction = "transferred_out"
	LifecycleTransferredIn  LifecycleAction = "transferred_in"
)

// LifecycleActorKind tells who made a change: a staff account of the school
// or a moto operator.
type LifecycleActorKind string

// The two kinds of actors a lifecycle entry names.
const (
	LifecycleActorSchoolStaff LifecycleActorKind = "school_staff"
	LifecycleActorOperator    LifecycleActorKind = "operator"
)

// The fields a lifecycle entry may carry before and after values for. Other
// names are refused, so a credential or another school can never reach the
// history.
const (
	LifecycleFieldName       = "name"
	LifecycleFieldDeviceID   = "device_id"
	LifecycleFieldDeviceType = "device_type"
	LifecycleFieldStatus     = "status"
)

// ErrInvalidLifecycleEvent is a lifecycle entry the owner refuses to store.
var ErrInvalidLifecycleEvent = errors.New("invalid device lifecycle event")

// LifecycleChange is one material value before and after a change. A nil
// side means the value did not exist.
type LifecycleChange struct {
	Before *string `json:"before"`
	After  *string `json:"after"`
}

// RecordLifecycleEvent appends one entry to a device's history. The entry
// belongs to the device's school; the owner reads it from the device row.
type RecordLifecycleEvent struct {
	DeviceRowID int64
	Action      LifecycleAction
	ActorKind   LifecycleActorKind
	// ActorID is the staff account or the operator, by ActorKind.
	ActorID int64
	Changes map[string]LifecycleChange
}

// LifecycleEvent is one stored entry of a device's history.
type LifecycleEvent struct {
	ID          int64
	TenantID    int64
	DeviceRowID int64
	Action      LifecycleAction
	ActorKind   LifecycleActorKind
	// ActorAccountID is the staff account that made the change; nil for an
	// operator and once the account is gone. The history stores no name.
	ActorAccountID *int64
	Changes        map[string]LifecycleChange
	OccurredAt     time.Time
}

// LifecycleHistory records and reads the Gerätelebenszyklus. It is a side
// capability next to Capability: a school reads the history of its own
// device, an operator in an administrative transaction the whole chain of a
// device across its transfers.
type LifecycleHistory interface {
	// RecordLifecycleEvent appends one entry in the caller's transaction.
	RecordLifecycleEvent(context.Context, RecordLifecycleEvent) error
	// ListLifecycleEvents reads the history of a device, newest first,
	// including the entries of the devices it was transferred from that the
	// caller may read. An unknown device is ErrDeviceNotFound.
	ListLifecycleEvents(context.Context, int64) ([]LifecycleEvent, error)
}

// LifecycleActorRef names who makes a device write that records itself in
// the history: creating a device and editing its master data write their
// entry in the same statement as the change.
type LifecycleActorRef struct {
	Kind LifecycleActorKind
	ID   int64
}

type lifecycleActorKey struct{}

// WithLifecycleActor marks the writes made with ctx as made by actor, so
// Administration's create and edit record themselves in the history.
func WithLifecycleActor(ctx context.Context, actor LifecycleActorRef) context.Context {
	return context.WithValue(ctx, lifecycleActorKey{}, actor)
}

// LifecycleActorFrom returns the actor WithLifecycleActor set.
func LifecycleActorFrom(ctx context.Context) (*LifecycleActorRef, bool) {
	actor, ok := ctx.Value(lifecycleActorKey{}).(LifecycleActorRef)
	if !ok || actor.ID <= 0 || (actor.Kind != LifecycleActorSchoolStaff && actor.Kind != LifecycleActorOperator) {
		return nil, false
	}
	return &actor, true
}

// LifecycleValue returns a pointer to a trimmed value, nil when it is empty.
func LifecycleValue(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

// Validate checks that an entry names a device, a known action and actor,
// and only the allowed fields with an actual change.
func (r RecordLifecycleEvent) Validate() error {
	if r.DeviceRowID <= 0 || r.ActorID <= 0 || !validLifecycleAction(r.Action) {
		return ErrInvalidLifecycleEvent
	}
	if r.ActorKind != LifecycleActorSchoolStaff && r.ActorKind != LifecycleActorOperator {
		return ErrInvalidLifecycleEvent
	}
	for field, change := range r.Changes {
		if !validLifecycleField(field) || equalLifecycleValues(change.Before, change.After) {
			return ErrInvalidLifecycleEvent
		}
	}
	return nil
}

func validLifecycleAction(action LifecycleAction) bool {
	switch action {
	case LifecycleCreated, LifecycleUpdated, LifecycleBlocked, LifecycleUnblocked, LifecycleStatusChanged,
		LifecycleKeyRotated, LifecycleRemoved, LifecycleTransferredOut, LifecycleTransferredIn:
		return true
	default:
		return false
	}
}

func validLifecycleField(field string) bool {
	switch field {
	case LifecycleFieldName, LifecycleFieldDeviceID, LifecycleFieldDeviceType, LifecycleFieldStatus:
		return true
	default:
		return false
	}
}

func equalLifecycleValues(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// LifecycleChanges collects the fields whose values differ. Unchanged fields
// are left out, so an edit without a material change records no fields.
func LifecycleChanges(pairs map[string][2]*string) map[string]LifecycleChange {
	changes := make(map[string]LifecycleChange, len(pairs))
	for field, pair := range pairs {
		if equalLifecycleValues(pair[0], pair[1]) {
			continue
		}
		changes[field] = LifecycleChange{Before: pair[0], After: pair[1]}
	}
	return changes
}
