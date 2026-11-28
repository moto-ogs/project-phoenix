package domain

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func TestNormalizeStaffPersonNamesTheRefusedField(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 9, 9)
	for _, tc := range []struct {
		name   string
		person StaffPerson
		field  string
	}{
		{"empty first name", StaffPerson{FirstName: "  ", LastName: "Keller"}, StaffFieldFirstName},
		{"last name over the column", StaffPerson{FirstName: "Jonas", LastName: strings.Repeat("k", 256)}, StaffFieldLastName},
		{"birthday not a day", StaffPerson{FirstName: "Jonas", LastName: "Keller", Birthday: "12.04.1990"}, StaffFieldBirthday},
		{"birthday not come yet", StaffPerson{FirstName: "Jonas", LastName: "Keller", Birthday: "2026-09-10"}, StaffFieldBirthday},
	} {
		_, err := NormalizeStaffPerson(tc.person, today)
		refused, ok := errors.AsType[*StaffPersonError](err)
		require.True(t, ok, tc.name)
		assert.Equal(t, tc.field, refused.Field, tc.name)
		assert.ErrorIs(t, err, ErrStaffStammdatenInvalid, tc.name)
	}

	decomposed, err := NormalizeStaffPerson(StaffPerson{FirstName: "Jonas", LastName: "Mu\u0308ller"}, today)
	require.NoError(t, err)
	assert.Equal(t, "Müller", decomposed.LastName, "a pasted decomposed name is stored like the typed one")

	umlauts := strings.Repeat("ü", 255)
	person, err := NormalizeStaffPerson(StaffPerson{FirstName: umlauts, LastName: "Keller"}, today)
	require.NoError(t, err, "the column counts characters: 255 umlauts fit although they take 510 bytes")
	assert.Equal(t, umlauts, person.FirstName)

	person, err = NormalizeStaffPerson(StaffPerson{FirstName: " Jonas ", LastName: "Keller ", Birthday: " 2026-09-09 "}, today)
	require.NoError(t, err)
	assert.Equal(t, StaffPerson{FirstName: "Jonas", LastName: "Keller", Birthday: "2026-09-09"}, person, "today is a birthday that has come")
}

func TestApplyPersonKeepsTheOldValueOfEveryChangedField(t *testing.T) {
	t.Parallel()
	record := TraegerStaffRecord{FirstName: "Mira", LastName: "Sommer", Birthday: ""}
	_, changes := record.ApplyPerson(StaffPerson{FirstName: "Mira", LastName: "Sommer"})
	assert.Empty(t, changes)

	corrected, changes := record.ApplyPerson(StaffPerson{FirstName: "Myra", LastName: "Sommer", Birthday: "1990-04-12"})
	assert.Equal(t, []StaffPersonChange{
		{Field: StaffFieldFirstName, Kind: StaffChangeChanged, Before: "Mira"},
		{Field: StaffFieldBirthday, Kind: StaffChangeChanged, Before: ""},
	}, changes)
	assert.Equal(t, TraegerStaffRecord{FirstName: "Myra", LastName: "Sommer", Birthday: "1990-04-12"}, corrected)

	record.Birthday = "1990-04-12"
	_, changes = record.ApplyPerson(StaffPerson{FirstName: "Mira", LastName: "Sommer"})
	assert.Equal(t, []StaffPersonChange{{Field: StaffFieldBirthday, Kind: StaffChangeRemoved, Before: "1990-04-12"}},
		changes, "an emptied birthday is removed")
}

// A name an import stored decomposed is the same name: a birthday-only
// correction neither rewrites it nor writes a trail entry for it.
func TestApplyPersonKeepsAStoredDecomposedName(t *testing.T) {
	t.Parallel()
	record := TraegerStaffRecord{FirstName: "Jonas", LastName: "Mu\u0308ller"}
	corrected, changes := record.ApplyPerson(StaffPerson{FirstName: "Jonas", LastName: "Müller", Birthday: "1990-04-12"})
	assert.Equal(t, []StaffPersonChange{{Field: StaffFieldBirthday, Kind: StaffChangeChanged, Before: ""}}, changes)
	assert.Equal(t, "Mu\u0308ller", corrected.LastName)
}

// A hire creates a person at every Einsatzort, whose names allow 200
// characters: a longer name is a field error before anything is created.
func TestNormalizeStaffHireRefusesANameTheSchoolCannotTake(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 9, 9)
	_, err := NormalizeStaffHire(StaffHire{FirstName: strings.Repeat("ü", 201), LastName: "Keller"}, today)
	refused, ok := errors.AsType[*StaffHireError](err)
	require.True(t, ok)
	assert.Equal(t, StaffFieldFirstName, refused.Field)
}

func TestNameMatchComparesNamesInNFC(t *testing.T) {
	t.Parallel()
	hire := StaffHire{FirstName: "Jonas", LastName: "Müller", Birthday: "1990-04-12"}
	assert.Equal(t, HireMatchNameBirthday, hire.NameMatch("jonas", "Mu\u0308ller", "1990-04-12"))
}

// #8208: a school differs where its names differ in NFC or where it lacks
// the record's birthday; the take-over keeps a birthday only the school has.
func TestPersonDifferencesAndTheTakeOverForOneSchool(t *testing.T) {
	t.Parallel()
	record := TraegerStaffRecord{FirstName: "Myra", LastName: "Müller", Birthday: "1990-04-12"}
	assert.Empty(t, record.PersonDifferences(StaffPerson{FirstName: "Myra", LastName: "Müller", Birthday: "1990-04-12"}))
	assert.Equal(t, []string{StaffFieldFirstName, StaffFieldBirthday},
		record.PersonDifferences(StaffPerson{FirstName: "Mira", LastName: "Müller", Birthday: ""}))
	assert.Equal(t, StaffPerson{FirstName: "Myra", LastName: "Müller", Birthday: "1990-04-12"}, record.PersonForSchool(StaffPerson{FirstName: "Mira"}))

	record.Birthday = ""
	school := StaffPerson{FirstName: "Myra", LastName: "Müller", Birthday: "1985-01-02"}
	assert.Empty(t, record.PersonDifferences(school), "a birthday the record lacks is no difference")
	assert.Equal(t, "1985-01-02", record.PersonForSchool(school).Birthday, "the take-over keeps the school's birthday")
}
