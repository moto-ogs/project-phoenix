package workforce

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// „Person einstellen“ (#7206, ADR 0089 sections 1 and 3, ADR 0254 of
// 16.11.2026): the Personalverwaltung hires a person no school knows yet.
// One call creates the Personalstamm and the Arbeitsvertrag at the Träger
// and, at every Einsatzort, the person and the employment in that school's
// tenant transaction. Access, transponder and role stay with the school.

// TraegerStaffViewHireCheck is the access log view of the check that a hired
// person may exist already: it names the people of a school the answer shows.
const TraegerStaffViewHireCheck = "staff_hire_check"

// Where a hire found a person with the same name and birthday.
const (
	TraegerStaffHireMatchRecord = "record"
	TraegerStaffHireMatchSchool = "school"
)

var (
	// ErrTraegerStaffHireInvalid refuses a hire; TraegerStaffHireError names
	// the field. A refused contract value is a TraegerContractError.
	ErrTraegerStaffHireInvalid = errors.New("workforce: the hire is invalid")
	// ErrTraegerStaffHireDuplicate holds a hire back because the Träger or
	// one of its schools already keeps a person with this name and birthday;
	// TraegerStaffHireDuplicateError names where. The Personalverwaltung
	// confirms that these are two people, or links the existing person.
	ErrTraegerStaffHireDuplicate = errors.New("workforce: a person with this name and birthday exists already")
)

// ErrTraegerStaffHireIncomplete reports a hire that failed after it created
// people at schools or the record; TraegerStaffHireIncompleteError names them.
var ErrTraegerStaffHireIncomplete = errors.New("workforce: the hire is incomplete")

// TraegerStaffHireIncompleteError names what a failed hire left behind:
// the schools that keep the new person, and RecordID when the record and its
// contract are saved too (0 otherwise). The Personalverwaltung completes it
// under „Ohne Akte“ or in the record; hiring again would create the person
// twice.
type TraegerStaffHireIncompleteError struct {
	RecordID int64
	Schools  []string
	Cause    error
}

func (e *TraegerStaffHireIncompleteError) Error() string {
	return fmt.Sprintf("workforce: hire incomplete after %d schools, record %d: %v", len(e.Schools), e.RecordID, e.Cause)
}

func (e *TraegerStaffHireIncompleteError) Unwrap() []error {
	return []error{ErrTraegerStaffHireIncomplete, e.Cause}
}

// TraegerStaffHireError names the part of a hire that is invalid.
type TraegerStaffHireError struct {
	Field  string
	Reason string
}

func (e *TraegerStaffHireError) Error() string {
	return fmt.Sprintf("workforce: hire %s: %s", e.Field, e.Reason)
}

func (e *TraegerStaffHireError) Unwrap() error { return ErrTraegerStaffHireInvalid }

// TraegerStaffHireMatch is one place a person with the hire's name and
// birthday exists: a record of the Träger (RecordID) or an employment of
// one of its schools without a record (SchoolID, SchoolName).
type TraegerStaffHireMatch struct {
	Kind       string `json:"kind"`
	RecordID   int64  `json:"staff_record_id,omitempty"`
	SchoolID   int64  `json:"school_id,omitempty"`
	SchoolName string `json:"school_name,omitempty"`
}

// TraegerStaffHireDuplicateError lists the matches of a held-back hire.
type TraegerStaffHireDuplicateError struct {
	Matches []TraegerStaffHireMatch
}

func (e *TraegerStaffHireDuplicateError) Error() string {
	return fmt.Sprintf("workforce: hire: %d existing people share name and birthday", len(e.Matches))
}

func (e *TraegerStaffHireDuplicateError) Unwrap() error { return ErrTraegerStaffHireDuplicate }

// TraegerStaffHireSite is one Einsatzort of a hire with its Soll Monday to
// Friday in minutes.
type TraegerStaffHireSite struct {
	SchoolID       int64
	WeekdayMinutes []int
}

// TraegerStaffHireInput is a new person with the contract and Einsatzorte.
// Birthday is a calendar day (YYYY-MM-DD) and required: the check for a
// person who exists already needs it. Email and Phone go to
// each Einsatzort, where the school invites and reaches the person.
// ConfirmDuplicate hires although a person with the same name and birthday
// exists.
type TraegerStaffHireInput struct {
	FirstName        string
	LastName         string
	Birthday         string
	Email            *string
	Phone            *string
	PersonnelNumber  *string
	Kind             string
	StartsOn         calendar.Date
	EndsOn           *calendar.Date
	Sites            []TraegerStaffHireSite
	ConfirmDuplicate bool
}

// TraegerStaffHires hires a person in the Träger-Portal. Hire checks the
// release, the personnel number at the Träger and at each Einsatzort and
// whether the person may exist already, before it creates anything. It then
// creates person and employment in each school's tenant transaction and the
// record with its Einsatzorte and contract in one Träger transaction (ADR
// 0105), and answers with the record as Record shows it. A school that
// could not take the personnel number or the Soll yet is named in
// UnsyncedSchools. A hire that fails after it created something answers
// with a TraegerStaffHireIncompleteError.
type TraegerStaffHires interface {
	Hire(ctx context.Context, actor TraegerStaffActor, input TraegerStaffHireInput) (TraegerStaffRecordDetail, error)
}

// TraegerSchoolPersonInput is the person a hire creates at a school.
// Birthday is a calendar day or empty.
type TraegerSchoolPersonInput struct {
	FirstName string
	LastName  string
	Birthday  string
}

// TraegerSchoolEmploymentInput is the employment a hire creates for a
// person of the school. EmploymentType is the kind the school knows for the
// contract, nil for a kind only the Träger knows.
type TraegerSchoolEmploymentInput struct {
	PersonID       int64
	EmploymentType *string
}

// TraegerSchoolPersons and TraegerSchoolEmployments below create the person
// and the employment of a hire in the school of the caller's tenant
// transaction, as guarded commands of their owners (ADR 0067). Neither gives
// the person an account, a transponder or a role.

// TraegerHirePersons creates the person of a hire at the People Directory.
type TraegerHirePersons interface {
	CreateSchoolPerson(ctx context.Context, person TraegerSchoolPersonInput) (int64, error)
}

// TraegerHireEmployments creates the employment of a hired person at School
// Membership and returns its ID, the Einsatzort of the record.
type TraegerHireEmployments interface {
	CreateSchoolEmployment(ctx context.Context, employment TraegerSchoolEmploymentInput) (int64, error)
}
