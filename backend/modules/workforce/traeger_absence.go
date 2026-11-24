package workforce

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The Abwesenheitsarten and Kontingente of a Träger (#4710, ADR 0089
// section 10 with its addendum of 14.11.2026). The Personalverwaltung keeps
// the types; Workforce writes each of them into every school of the Träger
// as a school type that names it. A school deviates only for its own
// Einsätze: it does not offer the type, or it allows at most a number of
// days per person and year. A person with a Personalakte has one Kontingent
// per type and year over all schools.

// TraegerStaffViewAbsenceAccounts is the access log view of the Kontingente
// of one Personalakte.
const TraegerStaffViewAbsenceAccounts = "staff_absence_accounts"

var (
	// ErrTraegerAbsenceTypeNotFound answers an unknown or foreign type.
	ErrTraegerAbsenceTypeNotFound = errors.New("workforce: traeger absence type not found")
	// ErrTraegerAbsenceTypeInvalid refuses a type; TraegerAbsenceTypeError
	// names the reason.
	ErrTraegerAbsenceTypeInvalid = errors.New("workforce: invalid traeger absence type")
	// ErrTraegerAbsenceTypeNameTaken refuses a second type of the same name.
	ErrTraegerAbsenceTypeNameTaken = errors.New("workforce: traeger absence type name is already taken")
	// ErrTraegerAbsenceTypeInUse refuses a new name once a school booked the
	// type: the bookings keep the name they were made under.
	ErrTraegerAbsenceTypeInUse = errors.New("workforce: traeger absence type is in use")
	// ErrAbsenceTypeKeptByTraeger refuses a school's change of what the
	// Träger keeps: name, allowance, rest rule and whether staff may request.
	ErrAbsenceTypeKeptByTraeger = errors.New("workforce: the Träger keeps this absence type")
	// ErrAbsenceTypeNotOffered refuses a booking of a Träger's type the
	// school does not offer for its Einsätze.
	ErrAbsenceTypeNotOffered = errors.New("workforce: the school does not offer this absence type")
	// ErrAbsenceTypeSchoolLimitExceeded refuses a booking beyond the days
	// per person and year the school allows for a Träger's type.
	ErrAbsenceTypeSchoolLimitExceeded = errors.New("workforce: the school's limit for this absence type is exceeded")
	// ErrTraegerAbsenceAllowanceBelowBooked refuses days for a person below
	// what the schools already booked or hold for open requests.
	ErrTraegerAbsenceAllowanceBelowBooked = errors.New("workforce: the allowance is below the booked days")
)

// TraegerAbsenceTypeError names why a type of the Träger is invalid.
type TraegerAbsenceTypeError struct{ Reason string }

func (e *TraegerAbsenceTypeError) Error() string { return e.Reason }
func (e *TraegerAbsenceTypeError) Unwrap() error { return ErrTraegerAbsenceTypeInvalid }

// TraegerAbsenceTypeSchool is how one school carries a type of its Träger:
// the school's own type it took over, if any, and its deviation.
type TraegerAbsenceTypeSchool struct {
	SchoolID   ident.ID `json:"school_id"`
	SchoolName string   `json:"school_name"`
	// Carried is false while the school does not have the type yet; the next
	// change of the type brings it there.
	Carried         bool     `json:"carried"`
	Offered         bool     `json:"offered"`
	SchoolLimitDays *float64 `json:"school_limit_days"`
}

// TraegerAbsenceType is one Abwesenheitsart of the Träger.
type TraegerAbsenceType struct {
	ID               ident.ID `json:"id"`
	Name             string   `json:"name"`
	AllowanceEnabled bool     `json:"allowance_enabled"`
	StandardDays     float64  `json:"standard_days"`
	// CarryoverUntil is "MM-DD" in the following year until which a rest
	// stays usable; "" lets it expire on 31.12.
	CarryoverUntil string                     `json:"carryover_until"`
	Requestable    bool                       `json:"requestable"`
	IsActive       bool                       `json:"is_active"`
	Schools        []TraegerAbsenceTypeSchool `json:"schools"`
	CreatedAt      time.Time                  `json:"created_at"`
	// Version is the token of the type's fields (ADR 0311); an update
	// sends it back.
	Version string `json:"version"`
}

// TraegerAbsenceTypeInput creates a type or, as an update, replaces every
// field.
type TraegerAbsenceTypeInput struct {
	Name             string
	AllowanceEnabled bool
	StandardDays     float64
	CarryoverUntil   string
	Requestable      bool
	IsActive         bool
	// ExpectedVersion is the Version the update was made on; a create
	// ignores it.
	ExpectedVersion string
}

// TraegerAbsenceTypeList is what the Personalverwaltung sees: the release,
// the schools and the types.
type TraegerAbsenceTypeList struct {
	Release *TraegerStaffRelease `json:"release"`
	Schools []TraegerStaffSchool `json:"schools"`
	Types   []TraegerAbsenceType `json:"types"`
}

// TraegerAbsenceSchoolUse is what one school's bookings take from an
// account.
type TraegerAbsenceSchoolUse struct {
	SchoolID     ident.ID `json:"school_id"`
	SchoolName   string   `json:"school_name"`
	TakenDays    float64  `json:"taken_days"`
	ReservedDays float64  `json:"reserved_days"`
	// LimitDays is the school's deviation for the type, nil without one.
	LimitDays *float64 `json:"limit_days"`
	Offered   bool     `json:"offered"`
}

// TraegerAbsenceAccount is the Kontingent of one Personalakte for one type
// and year over all schools.
type TraegerAbsenceAccount struct {
	AbsenceTypeID   ident.ID `json:"absence_type_id"`
	AbsenceTypeName string   `json:"absence_type_name"`
	Year            int      `json:"year"`
	EntitledDays    float64  `json:"entitled_days"`
	// Individual is true when the Personalverwaltung set the days for this
	// person; otherwise the type's standard applies.
	Individual    bool                      `json:"individual"`
	StandardDays  float64                   `json:"standard_days"`
	TakenDays     float64                   `json:"taken_days"`
	ReservedDays  float64                   `json:"reserved_days"`
	RemainingDays float64                   `json:"remaining_days"`
	ExpiresOn     string                    `json:"expires_on"`
	ExpiredDays   float64                   `json:"expired_days"`
	CarriedIn     *TraegerAbsenceCarry      `json:"carried_in"`
	Schools       []TraegerAbsenceSchoolUse `json:"schools"`
	// Version is the token of the person's claim of the type and year; the
	// change of the days sends it back as expected_version (ADR 0311).
	Version string `json:"version"`
}

// TraegerAbsenceCarry is the previous year's rest still usable in the
// account's year.
type TraegerAbsenceCarry struct {
	Year          int     `json:"year"`
	RemainingDays float64 `json:"remaining_days"`
	ExpiredDays   float64 `json:"expired_days"`
	ExpiresOn     string  `json:"expires_on"`
}

// TraegerAbsenceAccounts lists the accounts of one Personalakte in one year.
type TraegerAbsenceAccounts struct {
	Year     int                     `json:"year"`
	Accounts []TraegerAbsenceAccount `json:"accounts"`
}

// SetTraegerAbsenceAllowance sets the days of one person, type and year.
type SetTraegerAbsenceAllowance struct {
	RecordID      int64
	AbsenceTypeID int64
	Year          int
	EntitledDays  float64
	Reason        string
	// ExpectedVersion is the Version of the account the form was read from
	// (ADR 0311); a claim changed since is not overwritten.
	ExpectedVersion string
}

// TraegerAbsenceTypes is the Träger-Portal's part of the types and
// Kontingente. Every method checks the release; the route checks the right
// „Personal“. The accounts of a Personalakte write an access log entry at
// each of its Einsatzorte first (ADR 0084 section 7).
type TraegerAbsenceTypes interface {
	ListAbsenceTypes(ctx context.Context, actor TraegerStaffActor) (TraegerAbsenceTypeList, error)
	CreateAbsenceType(ctx context.Context, actor TraegerStaffActor, input TraegerAbsenceTypeInput) (TraegerAbsenceType, error)
	UpdateAbsenceType(ctx context.Context, actor TraegerStaffActor, id int64, input TraegerAbsenceTypeInput) (TraegerAbsenceType, error)
	AbsenceAccounts(ctx context.Context, actor TraegerStaffActor, recordID int64, year int) (TraegerAbsenceAccounts, error)
	SetAbsenceAllowance(ctx context.Context, actor TraegerStaffActor, input SetTraegerAbsenceAllowance) error
}
