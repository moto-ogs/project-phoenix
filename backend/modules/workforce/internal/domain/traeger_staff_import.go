package domain

import (
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Personal-Import of a Träger (#4724, ADR 0089 section 5): each row of a
// file becomes a Personalstamm or fills empty bank and tax values of the
// record with the same personnel number. The number is the only key; a row
// without a match is a new record and is never joined to a school's person
// by itself (the overview proposes that link afterwards). A row that
// contradicts its record changes nothing: a wrong number must not move bank
// data to another person.

// What the import does with a row.
const (
	StaffImportNew       = "new"
	StaffImportComplete  = "complete"
	StaffImportDuplicate = "duplicate"
	StaffImportConflict  = "conflict"
	StaffImportInvalid   = "invalid"
	StaffImportImported  = "imported"
)

// Problems of a row: a field and a code, never a value.
const (
	StaffImportProblemMissing  = "missing"
	StaffImportProblemInvalid  = "invalid"
	StaffImportProblemTooLong  = "too_long"
	StaffImportProblemFuture   = "future"
	StaffImportProblemRepeated = "repeated"
	StaffImportProblemDiffers  = "differs"
)

// maxStaffNameLength is the length of the name columns.
const maxStaffNameLength = 255

// StaffImportRaw is a row as the file has it, one cell per field.
type StaffImportRaw struct {
	PersonnelNumber      string
	FirstName            string
	LastName             string
	Birthday             string
	IBAN                 string
	TaxID                string
	SocialSecurityNumber string
}

// StaffImportValues is a row as a record keeps it: a trimmed name, the day
// as YYYY-MM-DD, bank and tax values without spaces. An empty value is
// absent.
type StaffImportValues struct {
	PersonnelNumber      string
	FirstName            string
	LastName             string
	Birthday             string
	IBAN                 string
	TaxID                string
	SocialSecurityNumber string
}

// Financial lists the bank and tax values by field.
func (v StaffImportValues) Financial() map[string]string {
	return map[string]string{StaffFieldIBAN: v.IBAN, StaffFieldTaxID: v.TaxID, StaffFieldSocialSecurityNumber: v.SocialSecurityNumber}
}

// StaffImportProblem names a field and what is wrong with it.
type StaffImportProblem struct {
	Field string
	Code  string
}

// StaffImportRecord is the record with the row's number: its names,
// birthday and opened bank and tax values by field.
type StaffImportRecord struct {
	ID        int64
	FirstName string
	LastName  string
	Birthday  string
	Financial map[string]string
}

// StaffImportCheck is the outcome of a row. Completes lists the bank and
// tax fields a complete row fills on its record.
type StaffImportCheck struct {
	Status    string
	Values    StaffImportValues
	RecordID  int64
	Problems  []StaffImportProblem
	Completes []string
}

// financialImportFields is the order the bank and tax fields are checked in.
var financialImportFields = []string{StaffFieldIBAN, StaffFieldTaxID, StaffFieldSocialSecurityNumber}

// CheckStaffImportRow reads a row and decides it against record, the
// record with its number, nil without one.
func CheckStaffImportRow(raw StaffImportRaw, record *StaffImportRecord, today calendar.Date) StaffImportCheck {
	values, problems := normalizeStaffImportRow(raw, today)
	check := StaffImportCheck{Values: values, Problems: problems}
	switch {
	case len(problems) > 0:
		check.Status = StaffImportInvalid
	case record == nil:
		check.Status = StaffImportNew
	default:
		check.RecordID = record.ID
		decideAgainstRecord(&check, *record)
	}
	return check
}

func decideAgainstRecord(check *StaffImportCheck, record StaffImportRecord) {
	values := check.Values
	for _, pair := range [][3]string{
		{StaffFieldFirstName, values.FirstName, record.FirstName},
		{StaffFieldLastName, values.LastName, record.LastName},
	} {
		if normalizedStaffValue(pair[0], pair[1]) != normalizedStaffValue(pair[0], pair[2]) {
			check.Problems = append(check.Problems, StaffImportProblem{Field: pair[0], Code: StaffImportProblemDiffers})
		}
	}
	if values.Birthday != "" && record.Birthday != "" && values.Birthday != record.Birthday {
		check.Problems = append(check.Problems, StaffImportProblem{Field: StaffFieldBirthday, Code: StaffImportProblemDiffers})
	}
	filled := values.Financial()
	for _, field := range financialImportFields {
		value, kept := filled[field], record.Financial[field]
		switch {
		case value == "" || normalizedStaffValue(field, value) == normalizedStaffValue(field, kept):
		case kept == "":
			check.Completes = append(check.Completes, field)
		default:
			check.Problems = append(check.Problems, StaffImportProblem{Field: field, Code: StaffImportProblemDiffers})
		}
	}
	switch {
	case len(check.Problems) > 0:
		check.Status, check.Completes = StaffImportConflict, nil
	case len(check.Completes) > 0:
		check.Status = StaffImportComplete
	default:
		check.Status = StaffImportDuplicate
	}
}

// MarkRepeatedStaffNumbers refuses every row whose number another row of
// the file carries too, read by StaffImportNumberKey: the file cannot say
// which one is right. A row that is invalid for another reason still counts,
// and stays invalid.
func MarkRepeatedStaffNumbers(checks []StaffImportCheck) {
	seen := map[string]int{}
	for _, check := range checks {
		if check.readableNumber() {
			seen[StaffImportNumberKey(check.Values.PersonnelNumber)]++
		}
	}
	for i := range checks {
		if checks[i].Status == StaffImportInvalid || seen[StaffImportNumberKey(checks[i].Values.PersonnelNumber)] < 2 {
			continue
		}
		checks[i].Status, checks[i].RecordID, checks[i].Completes = StaffImportConflict, 0, nil
		checks[i].Problems = []StaffImportProblem{{Field: StaffFieldPersonnelNumber, Code: StaffImportProblemRepeated}}
	}
}

// readableNumber tells whether the row carries a valid personnel number.
func (c StaffImportCheck) readableNumber() bool {
	for _, problem := range c.Problems {
		if problem.Field == StaffFieldPersonnelNumber && problem.Code != StaffImportProblemRepeated {
			return false
		}
	}
	return c.Values.PersonnelNumber != ""
}

// StaffImportNumberKey is the key a personnel number matches by: its digits
// without leading zeros. A spreadsheet program drops them when it saves the
// list, and "00123" and "123" are the same person in the payroll program.
func StaffImportNumberKey(number string) string {
	number = strings.TrimSpace(number)
	if key := strings.TrimLeft(number, "0"); key != "" || number == "" {
		return key
	}
	return "0"
}

func normalizeStaffImportRow(raw StaffImportRaw, today calendar.Date) (StaffImportValues, []StaffImportProblem) {
	var problems []StaffImportProblem
	add := func(field, code string) { problems = append(problems, StaffImportProblem{Field: field, Code: code}) }
	values := StaffImportValues{
		PersonnelNumber: strings.TrimSpace(raw.PersonnelNumber),
		FirstName:       strings.TrimSpace(raw.FirstName),
		LastName:        strings.TrimSpace(raw.LastName),
	}
	switch {
	case values.PersonnelNumber == "":
		add(StaffFieldPersonnelNumber, StaffImportProblemMissing)
	case !personnelNumberPattern.MatchString(values.PersonnelNumber):
		add(StaffFieldPersonnelNumber, StaffImportProblemInvalid)
	}
	for _, field := range [][2]string{{StaffFieldFirstName, values.FirstName}, {StaffFieldLastName, values.LastName}} {
		switch {
		case field[1] == "":
			add(field[0], StaffImportProblemMissing)
		case utf8.RuneCountInString(field[1]) > maxStaffNameLength:
			add(field[0], StaffImportProblemTooLong)
		}
	}
	if birthday := strings.TrimSpace(raw.Birthday); birthday != "" {
		day, ok := parseImportDay(birthday)
		switch {
		case !ok:
			add(StaffFieldBirthday, StaffImportProblemInvalid)
		case day.After(today):
			add(StaffFieldBirthday, StaffImportProblemFuture)
		default:
			values.Birthday = day.String()
		}
	}
	for _, field := range financialImportFields {
		section := FinancialSection{}
		cell := raw.IBAN
		target := &values.IBAN
		switch field {
		case StaffFieldIBAN:
			section.IBAN = &cell
		case StaffFieldTaxID:
			cell, target = raw.TaxID, &values.TaxID
			section.TaxID = &cell
		default:
			cell, target = raw.SocialSecurityNumber, &values.SocialSecurityNumber
			section.SocialSecurityNumber = &cell
		}
		normalized, err := NormalizeFinancialSection(section)
		if err != nil {
			add(field, StaffImportProblemInvalid)
			continue
		}
		*target = Deref(firstNonNil(normalized.IBAN, normalized.TaxID, normalized.SocialSecurityNumber))
	}
	return values, problems
}

func firstNonNil(values ...*string) *string {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

// parseImportDay reads a day as office programs export it: 02.04.1990,
// 2.4.1990 or 1990-04-02, each also with a time after it, which is dropped.
func parseImportDay(value string) (calendar.Date, bool) {
	if cut := strings.IndexAny(value, " T"); cut > 0 {
		value = value[:cut]
	}
	if day, err := calendar.ParseDate(value); err == nil {
		return day, true
	}
	parts := strings.Split(value, ".")
	if len(parts) != 3 || len(parts[2]) != 4 {
		return "", false
	}
	numbers := make([]int, 3)
	for i, part := range parts {
		number, err := strconv.Atoi(part)
		if err != nil || len(part) == 0 || len(part) > 4 {
			return "", false
		}
		numbers[i] = number
	}
	day := calendar.NewDate(numbers[2], time.Month(numbers[1]), numbers[0])
	if day.Day() != numbers[0] || int(day.Month()) != numbers[1] {
		return "", false
	}
	return day, true
}
