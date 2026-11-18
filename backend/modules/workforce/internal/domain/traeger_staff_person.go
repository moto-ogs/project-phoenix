package domain

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The correction of the person in a Personalstamm (#7379): the
// Personalverwaltung fixes first name, last name and birthday of the record.
// The schools keep their own person rows (ADR 0089 section 3); the record's
// values are what the Träger's lists, exports, the proposals and the
// duplicate check of a hire read.

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

// maxRecordNameLength is the width of the name columns of a record.
const maxRecordNameLength = 255

// NormalizeStaffPerson trims the names to NFC and checks every value: both
// names are required and fit their columns, a birthday is a past day as
// YYYY-MM-DD or empty. today refuses a birthday that has not come yet.
func NormalizeStaffPerson(person StaffPerson, today calendar.Date) (StaffPerson, error) {
	person.FirstName, person.LastName = textnorm.Name(person.FirstName), textnorm.Name(person.LastName)
	if field, ok := invalidStaffName(person.FirstName, person.LastName, maxRecordNameLength); ok {
		return StaffPerson{}, &StaffPersonError{Field: field, Reason: "is required, at most 255 characters"}
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

// invalidStaffName names the first of two trimmed names that is empty or
// longer than limit characters (not bytes: an umlaut is one character).
func invalidStaffName(firstName, lastName string, limit int) (string, bool) {
	for _, name := range []struct{ field, value string }{{StaffFieldFirstName, firstName}, {StaffFieldLastName, lastName}} {
		if name.value == "" || utf8.RuneCountInString(name.value) > limit {
			return name.field, true
		}
	}
	return "", false
}

// PersonChanges lists the fields of the record person differs in, in the
// order of StaffRecordFields, each with the record's value before. A value
// the correction empties (only the birthday may be empty) is removed, every
// other difference changed.
func (r TraegerStaffRecord) PersonChanges(person StaffPerson) []StaffPersonChange {
	var changes []StaffPersonChange
	for _, field := range []struct{ name, before, after string }{
		{StaffFieldFirstName, r.FirstName, person.FirstName},
		{StaffFieldLastName, r.LastName, person.LastName},
		{StaffFieldBirthday, r.Birthday, person.Birthday},
	} {
		if field.before == field.after {
			continue
		}
		kind := StaffChangeChanged
		if field.after == "" {
			kind = StaffChangeRemoved
		}
		changes = append(changes, StaffPersonChange{Field: field.name, Kind: kind, Before: field.before})
	}
	return changes
}

// StaffPersonChange is one field a correction changes or removes, with its
// old value.
type StaffPersonChange struct {
	Field  string
	Kind   string
	Before string
}
