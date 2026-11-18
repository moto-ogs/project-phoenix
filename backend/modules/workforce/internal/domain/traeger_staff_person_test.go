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

	person, err := NormalizeStaffPerson(StaffPerson{FirstName: " Jonas ", LastName: "Keller ", Birthday: " 2026-09-09 "}, today)
	require.NoError(t, err)
	assert.Equal(t, StaffPerson{FirstName: "Jonas", LastName: "Keller", Birthday: "2026-09-09"}, person, "today is a birthday that has come")
}

func TestPersonChangesKeepTheOldValueOfEveryChangedField(t *testing.T) {
	t.Parallel()
	record := TraegerStaffRecord{FirstName: "Mira", LastName: "Sommer", Birthday: ""}
	assert.Empty(t, record.PersonChanges(StaffPerson{FirstName: "Mira", LastName: "Sommer"}))
	assert.Equal(t, []StaffPersonChange{
		{Field: StaffFieldFirstName, Before: "Mira"},
		{Field: StaffFieldBirthday, Before: ""},
	}, record.PersonChanges(StaffPerson{FirstName: "Myra", LastName: "Sommer", Birthday: "1990-04-12"}))
}
