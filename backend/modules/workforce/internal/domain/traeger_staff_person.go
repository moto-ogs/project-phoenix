package domain

import (
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The correction of the person in a Personalstamm (#7379): the
// Personalverwaltung fixes first name, last name and birthday of the record.
// The schools keep their own person rows (ADR 0089 section 3); the record's
// values are what the Träger's lists, exports and the duplicate check of a
// hire read.

// StaffPerson is the person of a record as entered or, from
// NormalizeStaffPerson, as saved. Birthday is a calendar day or empty.
type StaffPerson struct {
	FirstName string
	LastName  string
	Birthday  string
}

// StaffPersonError names the refused field of a person correction. It is a
// refused master data value (ErrStaffStammdatenInvalid).
type StaffPersonError struct {
	Field  string
	Reason string
}

func (e *StaffPersonError) Error() string {
	return fmt.Sprintf("%v: %s %s", ErrStaffStammdatenInvalid, e.Field, e.Reason)
}

func (e *StaffPersonError) Unwrap() error { return ErrStaffStammdatenInvalid }

// NormalizeStaffPerson trims the names and checks every value: both names
// are required and fit their columns, a birthday is a past day as
// YYYY-MM-DD or empty. today refuses a birthday that has not come yet.
func NormalizeStaffPerson(person StaffPerson, today calendar.Date) (StaffPerson, error) {
	person.FirstName, person.LastName = strings.TrimSpace(person.FirstName), strings.TrimSpace(person.LastName)
	for _, name := range []struct{ field, value string }{{StaffFieldFirstName, person.FirstName}, {StaffFieldLastName, person.LastName}} {
		if name.value == "" || len(name.value) > maxHireNameLength {
			return StaffPerson{}, &StaffPersonError{Field: name.field, Reason: "is required, at most 255 characters"}
		}
	}
	person.Birthday = strings.TrimSpace(person.Birthday)
	if person.Birthday == "" {
		return person, nil
	}
	birthday, err := calendar.ParseDate(person.Birthday)
	if err != nil || birthday.After(today) {
		return StaffPerson{}, &StaffPersonError{Field: StaffFieldBirthday, Reason: "must be a past day as YYYY-MM-DD"}
	}
	person.Birthday = birthday.String()
	return person, nil
}

// PersonChanges lists the fields of the record person differs in, in the
// order of StaffRecordFields, each with the record's value before.
func (r TraegerStaffRecord) PersonChanges(person StaffPerson) []StaffPersonChange {
	var changes []StaffPersonChange
	for _, field := range []struct{ name, before, after string }{
		{StaffFieldFirstName, r.FirstName, person.FirstName},
		{StaffFieldLastName, r.LastName, person.LastName},
		{StaffFieldBirthday, r.Birthday, person.Birthday},
	} {
		if field.before != field.after {
			changes = append(changes, StaffPersonChange{Field: field.name, Before: field.before})
		}
	}
	return changes
}

// StaffPersonChange is one field a correction changes, with its old value.
type StaffPersonChange struct {
	Field  string
	Before string
}
