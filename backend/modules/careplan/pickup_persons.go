package careplan

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The pickup person of one day (#7655): who collects one child on one day,
// next to the Gehzeit (PickupException) and the Abholart (DepartureException)
// of that day. The free-text PickupNote stays as it is.

// PickupPersonNameMaxLength is the longest name the day value keeps.
const PickupPersonNameMaxLength = 120

var (
	// ErrPickupPersonInvalid refuses an empty or too long name or a missing
	// child or day.
	ErrPickupPersonInvalid = errors.New("die Abholperson braucht einen Namen mit höchstens 120 Zeichen")
	// ErrPickupPersonPastDate refuses a day before today: the pickup has
	// happened, and the value of that day is deleted.
	ErrPickupPersonPastDate = errors.New("die Abholperson kann nur für heute oder einen späteren Tag eingetragen werden")
	// ErrPickupPersonNotCareDay refuses a day where the school does not run
	// care.
	ErrPickupPersonNotCareDay = errors.New("die Abholperson kann nur an einem Betreuungstag eingetragen werden")
	// ErrPickupPersonGuardianNotAuthorized refuses a contact whose pickup
	// permission no longer applies while the day's person is being saved.
	ErrPickupPersonGuardianNotAuthorized = errors.New("the contact has no pickup permission for the child on this day")
	// ErrPickupPersonChanged refuses reverting an approval after another
	// write replaced or changed its pickup person.
	ErrPickupPersonChanged = errors.New("die Abholperson wurde inzwischen geändert")
)

// PickupPerson is who collects the child on ExceptionDate. GuardianProfileID
// names a contact with a standing pickup permission; Name is then the name
// the contact had when the day was set. Without GuardianProfileID the person
// is a one-time person: only the name is kept, and the staff check the ID
// card at the pickup. The nightly retention deletes the value once its day
// has passed.
type PickupPerson struct {
	ID                int64
	TenantID          int64
	CreatedAt         time.Time
	UpdatedAt         time.Time
	StudentID         int64
	ExceptionDate     Date
	Name              string
	GuardianProfileID *int64
	// CreatedBy is the staff membership that set the value; nil after that
	// membership was deleted.
	CreatedBy *int64
	// RequestedByGuardian is the guardian account whose one-day request
	// named the person (#8162); the OGS approval wrote the value. Nil for a
	// value the staff set.
	RequestedByGuardian *int64
}

// PickupPersonGuardianAuthorization names the relationship and plan weekday
// whose pickup permission authorizes a named contact. Care Plan locks and
// checks that permission in the same transaction that saves the day value.
// A nil value authorizes a one-time person instead.
type PickupPersonGuardianAuthorization struct {
	RelationshipID int64
	Weekday        int
}

// OneTime reports whether the person has no standing pickup permission.
func (p PickupPerson) OneTime() bool { return p.GuardianProfileID == nil }

// DayPickup is the Abholart and the pickup person one child has on one day;
// either may be nil. A day view reads both in one statement.
type DayPickup struct {
	StudentID int64
	Date      Date
	Departure *DepartureException
	Person    *PickupPerson
}

// ApprovedPickupPersons writes the pickup person a family named in its
// one-day request, once the OGS approved it (#8162). Every command takes the
// care-day lock; only the care request decisions and corrections call it.
type ApprovedPickupPersons interface {
	SaveApprovedPickupPerson(ctx context.Context, person PickupPerson) (PickupPerson, error)
	// DeleteApprovedPickupPerson takes back the row id of the child's day an
	// approval wrote, under the care-day lock, when its decision is
	// corrected; false when the row is gone.
	DeleteApprovedPickupPerson(ctx context.Context, studentID int64, date calendar.Date, id int64, expectedVersion string) (bool, error)
}

// PickupPersons is the owner's capability for the pickup person of a day.
// Every call runs in the caller's tenant transaction.
type PickupPersons interface {
	// ListDayPickups reads the Abholart and the pickup person of every child
	// and day from from to to (a zero to has no end), limited to studentIDs
	// when given, in one statement, ordered by day and child. A reader of
	// days other than its today hides the persons of past days.
	ListDayPickups(ctx context.Context, from, to calendar.Date, studentIDs []int64) ([]DayPickup, error)
	// SetPickupPerson replaces the pickup person of the child's day under
	// the care-day lock. For a named contact, it locks and rechecks the
	// current pickup permission before the upsert.
	SetPickupPerson(ctx context.Context, person PickupPerson, staffID int64, guardian *PickupPersonGuardianAuthorization) (PickupPerson, error)
	// DeletePickupPerson removes the pickup person of the child's day;
	// false when the day had none.
	DeletePickupPerson(ctx context.Context, studentID int64, date calendar.Date) (bool, error)
}
