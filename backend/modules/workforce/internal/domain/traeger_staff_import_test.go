package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var importToday = calendar.NewDate(2026, time.November, 15)

func TestCheckStaffImportRowReadsANewPerson(t *testing.T) {
	t.Parallel()
	check := CheckStaffImportRow(StaffImportRaw{
		PersonnelNumber: " 70031 ", FirstName: "Mira", LastName: "Sommer", Birthday: "02.04.1990 00:00",
		IBAN: "de89 3704 0044 0532 0130 00", TaxID: "12 345 678 901", SocialSecurityNumber: "65170839j003",
	}, nil, importToday)

	assert.Equal(t, StaffImportNew, check.Status)
	assert.Empty(t, check.Problems)
	assert.Equal(t, StaffImportValues{
		PersonnelNumber: "70031", FirstName: "Mira", LastName: "Sommer", Birthday: "1990-04-02",
		IBAN: "DE89370400440532013000", TaxID: "12345678901", SocialSecurityNumber: "65170839J003",
	}, check.Values, "a value is read as the record keeps it: ISO day, IBAN without spaces")
}

func TestCheckStaffImportRowNamesEveryProblem(t *testing.T) {
	t.Parallel()
	check := CheckStaffImportRow(StaffImportRaw{
		FirstName: "Mira", LastName: "", Birthday: "31.12.2027", IBAN: "DE00 1234", TaxID: "123",
	}, nil, importToday)

	assert.Equal(t, StaffImportInvalid, check.Status)
	assert.Equal(t, []StaffImportProblem{
		{Field: StaffFieldPersonnelNumber, Code: StaffImportProblemMissing},
		{Field: StaffFieldLastName, Code: StaffImportProblemMissing},
		{Field: StaffFieldBirthday, Code: StaffImportProblemFuture},
		{Field: StaffFieldIBAN, Code: StaffImportProblemInvalid},
		{Field: StaffFieldTaxID, Code: StaffImportProblemInvalid},
	}, check.Problems)

	letters := CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "P-12", FirstName: "A", LastName: "B", Birthday: "2.4."}, nil, importToday)
	assert.Equal(t, []StaffImportProblem{
		{Field: StaffFieldPersonnelNumber, Code: StaffImportProblemInvalid},
		{Field: StaffFieldBirthday, Code: StaffImportProblemInvalid},
	}, letters.Problems, "a number is digits only, as DATEV matches it")
}

func TestCheckStaffImportRowAgainstTheRecordWithItsNumber(t *testing.T) {
	t.Parallel()
	record := &StaffImportRecord{
		ID: 7, FirstName: "Mira", LastName: "Sommer", Birthday: "1990-04-02",
		Financial: map[string]string{StaffFieldTaxID: "12345678901"},
	}
	raw := StaffImportRaw{PersonnelNumber: "70031", FirstName: " mira", LastName: "SOMMER", Birthday: "1990-04-02", TaxID: "12345678901"}

	same := CheckStaffImportRow(raw, record, importToday)
	assert.Equal(t, StaffImportDuplicate, same.Status, "a repeated import changes nothing; names compare without case and space")
	assert.Equal(t, record.ID, same.RecordID)

	raw.IBAN = "DE89370400440532013000"
	completing := CheckStaffImportRow(raw, record, importToday)
	assert.Equal(t, StaffImportComplete, completing.Status)
	assert.Equal(t, []string{StaffFieldIBAN}, completing.Completes, "an empty bank value of the record is filled in")

	raw.LastName, raw.TaxID = "Sommer-Berg", "98765432109"
	differing := CheckStaffImportRow(raw, record, importToday)
	assert.Equal(t, StaffImportConflict, differing.Status, "a wrong number must not carry bank data to another person")
	assert.Equal(t, []StaffImportProblem{
		{Field: StaffFieldLastName, Code: StaffImportProblemDiffers},
		{Field: StaffFieldTaxID, Code: StaffImportProblemDiffers},
	}, differing.Problems)
	assert.Empty(t, differing.Completes, "a conflict takes over nothing")
}

func TestMarkRepeatedStaffNumbersRefusesEveryRowOfANumber(t *testing.T) {
	t.Parallel()
	checks := []StaffImportCheck{
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "1", FirstName: "A", LastName: "B"}, nil, importToday),
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "2", FirstName: "C", LastName: "D"}, nil, importToday),
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "1", FirstName: "E", LastName: "F"}, nil, importToday),
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "1", LastName: "G"}, nil, importToday),
	}

	MarkRepeatedStaffNumbers(checks)

	assert.Equal(t, StaffImportConflict, checks[0].Status, "the file cannot say which row is right")
	assert.Equal(t, []StaffImportProblem{{Field: StaffFieldPersonnelNumber, Code: StaffImportProblemRepeated}}, checks[0].Problems)
	assert.Equal(t, StaffImportNew, checks[1].Status)
	assert.Equal(t, StaffImportConflict, checks[2].Status)
	assert.Equal(t, StaffImportInvalid, checks[3].Status, "an invalid row stays invalid")
}

func TestMarkRepeatedStaffNumbersCountsInvalidRowsAndLeadingZeros(t *testing.T) {
	t.Parallel()
	checks := []StaffImportCheck{
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "70040", FirstName: "Ole", LastName: "Wendt", IBAN: "DE00"}, nil, importToday),
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "70040", FirstName: "Ole", LastName: "Wendt-Berg"}, nil, importToday),
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "00123", FirstName: "A", LastName: "B"}, nil, importToday),
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "123", FirstName: "A", LastName: "B"}, nil, importToday),
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "x1", FirstName: "C", LastName: "D"}, nil, importToday),
		CheckStaffImportRow(StaffImportRaw{PersonnelNumber: "x1", FirstName: "C", LastName: "D"}, nil, importToday),
	}

	MarkRepeatedStaffNumbers(checks)

	assert.Equal(t, StaffImportInvalid, checks[0].Status, "the invalid row keeps its own problem")
	assert.Equal(t, StaffImportConflict, checks[1].Status, "the file holds two versions of 70040")
	assert.Equal(t, StaffImportConflict, checks[2].Status, "a spreadsheet drops leading zeros: 00123 is 123")
	assert.Equal(t, StaffImportConflict, checks[3].Status)
	assert.Equal(t, StaffImportInvalid, checks[4].Status, "an unreadable number repeats nothing")
	assert.Equal(t, []StaffImportProblem{{Field: StaffFieldPersonnelNumber, Code: StaffImportProblemInvalid}}, checks[5].Problems)
}

func TestStaffImportNumberKeyDropsLeadingZeros(t *testing.T) {
	t.Parallel()
	for number, key := range map[string]string{"00123": "123", " 123 ": "123", "0": "0", "000": "0", "": "", "70040": "70040"} {
		assert.Equal(t, key, StaffImportNumberKey(number), number)
	}
}
