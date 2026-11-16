package domain

import (
	"errors"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// „Person einstellen“ (#7206, ADR 0089 sections 1 and 3): the
// Personalverwaltung hires a person no school knows yet. The hire names the
// person, the Arbeitsvertrag and the Soll of each Einsatzort; the record, the
// contract and the employments come from it.

// ErrStaffHireInvalid refuses a hire; StaffHireError names the field.
var ErrStaffHireInvalid = errors.New("the hire is invalid")

// StaffHireError names the refused field of a hire.
type StaffHireError struct {
	Field  string
	Reason string
}

func (e *StaffHireError) Error() string { return fmt.Sprintf("hire %s: %s", e.Field, e.Reason) }
func (e *StaffHireError) Unwrap() error { return ErrStaffHireInvalid }

func hireInvalid(field, reason string) error { return &StaffHireError{Field: field, Reason: reason} }

// maxHireNameLength is the width of the name columns of a person and a record.
const maxHireNameLength = 255

// StaffHireSite is the Soll of one Einsatzort of a hire, Monday to Friday.
type StaffHireSite struct {
	SchoolID       int64
	WeekdayMinutes []int
}

// StaffHire is a hire as entered, or, from NormalizeStaffHire, as checked.
// Birthday is a calendar day, required for the check whether the person
// exists already; EndsOn is zero for an open contract.
type StaffHire struct {
	FirstName       string
	LastName        string
	Birthday        string
	Email           *string
	Phone           *string
	PersonnelNumber *string
	Kind            string
	StartsOn        calendar.Date
	EndsOn          calendar.Date
	Sites           []StaffHireSite
}

// NormalizeStaffHire trims the person, checks every value and returns the
// hire as it is saved. today refuses a birthday that has not come yet. A
// refused contract value is a ContractError, like in the contract dialog.
func NormalizeStaffHire(hire StaffHire, today calendar.Date) (StaffHire, error) {
	hire.FirstName, hire.LastName = strings.TrimSpace(hire.FirstName), strings.TrimSpace(hire.LastName)
	for _, name := range []struct{ field, value string }{{"first_name", hire.FirstName}, {"last_name", hire.LastName}} {
		if name.value == "" || len(name.value) > maxHireNameLength {
			return StaffHire{}, hireInvalid(name.field, "a name of at most 255 characters is required")
		}
	}
	hire.Birthday = strings.TrimSpace(hire.Birthday)
	if birthday, err := calendar.ParseDate(hire.Birthday); err != nil || birthday.After(today) {
		return StaffHire{}, hireInvalid("birthday", "the birthday is required, a past day as YYYY-MM-DD")
	}
	contact, err := NormalizeContactSection(ContactSection{Email: hire.Email, Phone: hire.Phone})
	if err != nil {
		return StaffHire{}, hireInvalid("email", "malformed email address")
	}
	hire.Email, hire.Phone = contact.Email, contact.Phone
	if hire.PersonnelNumber, err = NormalizePersonnelNumber(hire.PersonnelNumber); err != nil {
		return StaffHire{}, err
	}
	if err := ValidateContractTerms(hire.Kind, hire.StartsOn, hire.EndsOn); err != nil {
		return StaffHire{}, err
	}
	return hire, validateHireSites(hire.Sites)
}

func validateHireSites(sites []StaffHireSite) error {
	if len(sites) == 0 || len(sites) > MaxLinkMembers {
		return hireInvalid("sites", "between one and fifty Einsatzorte are required")
	}
	seen := make(map[int64]bool, len(sites))
	for _, site := range sites {
		if site.SchoolID <= 0 || seen[site.SchoolID] {
			return hireInvalid("sites", "every Einsatzort is one school, named once")
		}
		seen[site.SchoolID] = true
		if err := ValidateWeekdayMinutes("sites", site.WeekdayMinutes); err != nil {
			return err
		}
	}
	return nil
}

// SchoolEmploymentType is the kind a school knows for an employment; the
// kinds only the Träger knows (Übungsleiter, Ehrenamt) have none.
func SchoolEmploymentType(contractKind string) *string {
	switch contractKind {
	case ContractKindFullTime, ContractKindPartTime, ContractKindMinijob:
		return &contractKind
	default:
		return nil
	}
}

// SamePerson reports whether a hire names a person by first name, last name
// and birthday like someone the Träger or a school already keeps. Like the
// proposals of ADR 0089 section 5 a name without a birthday is no match.
func (h StaffHire) SamePerson(firstName, lastName, birthday string) bool {
	return sharesKey(nameBirthdayKey(h.FirstName, h.LastName, h.Birthday), nameBirthdayKey(firstName, lastName, birthday))
}
