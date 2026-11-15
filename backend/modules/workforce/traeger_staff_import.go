package workforce

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// The Personal-Import of the Träger-Portal (#4724, ADR 0089 section 5): a
// new Träger takes its staff over from a CSV file of its payroll or office
// program. The office maps the columns of its file; the preview shows every
// row with what moto would do before anything is stored. The personnel
// number is the only key: a row without a record of that number becomes a
// new record, a row with one fills only empty bank and tax values, and a
// row that contradicts its record changes nothing. A repeated import
// therefore creates no duplicate. The file is never stored; the trail of
// each record keeps the name of the file and the line it came from.

// Fields of a record a column of the file can be mapped to.
const (
	StaffImportFieldPersonnelNumber      = TraegerStaffFieldPersonnelNumber
	StaffImportFieldFirstName            = TraegerStaffFieldFirstName
	StaffImportFieldLastName             = TraegerStaffFieldLastName
	StaffImportFieldBirthday             = TraegerStaffFieldBirthday
	StaffImportFieldIBAN                 = TraegerStaffFieldIBAN
	StaffImportFieldTaxID                = TraegerStaffFieldTaxID
	StaffImportFieldSocialSecurityNumber = TraegerStaffFieldSocialSecurityNumber
)

// What the import does with a row.
const (
	// StaffImportRowNew becomes a new record.
	StaffImportRowNew = "new"
	// StaffImportRowComplete fills empty bank and tax values of the record
	// with its number; Completes names them.
	StaffImportRowComplete = "complete"
	// StaffImportRowDuplicate is the record as it is: a repeated import
	// skips it.
	StaffImportRowDuplicate = "duplicate"
	// StaffImportRowConflict contradicts its record or another row; nothing
	// of it is taken over.
	StaffImportRowConflict = "conflict"
	// StaffImportRowInvalid misses a field or carries a value no record
	// takes.
	StaffImportRowInvalid = "invalid"
	// StaffImportRowImported is a row the import stored.
	StaffImportRowImported = "imported"
)

// Problems of a row. Each names a field and a code; none repeats a value.
const (
	StaffImportProblemMissing  = "missing"
	StaffImportProblemInvalid  = "invalid"
	StaffImportProblemTooLong  = "too_long"
	StaffImportProblemFuture   = "future"
	StaffImportProblemRepeated = "repeated"
	StaffImportProblemDiffers  = "differs"
)

// Limits of an import file.
const (
	MaxStaffImportFileBytes = 2 << 20
	MaxStaffImportRows      = 5000
	// MaxStaffImportFileNameLength bounds the file name the trail keeps.
	MaxStaffImportFileNameLength = 200
)

// TraegerStaffViewImport is the access log view of an import preview: the
// records its rows match.
const TraegerStaffViewImport = "staff_import"

var (
	// ErrStaffImportFileInvalid reports a file that is no readable CSV with
	// a header and at least one row.
	ErrStaffImportFileInvalid = errors.New("workforce: the import file is no readable CSV file with a header row and data rows")
	// ErrStaffImportFileTooLarge reports a file over MaxStaffImportFileBytes
	// or with more than MaxStaffImportRows rows.
	ErrStaffImportFileTooLarge = errors.New("workforce: the import file is too large")
	// ErrStaffImportChanged reports an import whose rows are no longer what
	// the office confirmed in the preview.
	ErrStaffImportChanged = errors.New("workforce: the import differs from the confirmed preview")
	// ErrStaffImportMappingInvalid reports a mapping that names no column of
	// the file or leaves a required field without one; the
	// StaffImportMappingError names the field.
	ErrStaffImportMappingInvalid = errors.New("workforce: the column mapping is invalid")
)

// StaffImportMappingError names the field of a mapping that is invalid.
type StaffImportMappingError struct {
	Field  string
	Reason string
}

func (e *StaffImportMappingError) Error() string {
	return fmt.Sprintf("workforce: import mapping %s: %s", e.Field, e.Reason)
}

func (e *StaffImportMappingError) Unwrap() error { return ErrStaffImportMappingInvalid }

// StaffImportColumns names per field the header of the column it comes
// from; empty leaves the field unmapped.
type StaffImportColumns struct {
	PersonnelNumber      string `json:"personnel_number"`
	FirstName            string `json:"first_name"`
	LastName             string `json:"last_name"`
	Birthday             string `json:"birthday"`
	IBAN                 string `json:"iban"`
	TaxID                string `json:"tax_id"`
	SocialSecurityNumber string `json:"social_security_number"`
}

// StaffImportMapping is how the rows of a file become records.
type StaffImportMapping struct {
	Columns StaffImportColumns `json:"columns"`
}

// StaffImportRequest is one look at a file: the preview when Apply is not
// set, the import of its new and complete rows when it is. Mapping nil
// takes the mapping moto suggests from the headers. Delimiter is ";", ","
// or "\t", empty detects it. Fingerprint is the fingerprint of the preview
// the office confirmed; Apply refuses with ErrStaffImportChanged when the
// rows differ from it.
type StaffImportRequest struct {
	Content     []byte
	FileName    string
	Delimiter   string
	Mapping     *StaffImportMapping
	Apply       bool
	Fingerprint string
}

// StaffImportProblem is one problem of a row: the field and the code.
type StaffImportProblem struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

// StaffImportRow is a row of the file as the import reads it. Bank and tax
// values show only their mask, and only when they are valid. RecordID is
// the record with the row's number, or the record the import created.
type StaffImportRow struct {
	Line                       int                  `json:"line"`
	Status                     string               `json:"status"`
	PersonnelNumber            string               `json:"personnel_number"`
	FirstName                  string               `json:"first_name"`
	LastName                   string               `json:"last_name"`
	Birthday                   string               `json:"birthday,omitempty"`
	IBANMasked                 string               `json:"iban_masked,omitempty"`
	TaxIDMasked                string               `json:"tax_id_masked,omitempty"`
	SocialSecurityNumberMasked string               `json:"social_security_number_masked,omitempty"`
	RecordID                   int64                `json:"staff_record_id,omitempty"`
	Completes                  []string             `json:"completes"`
	Problems                   []StaffImportProblem `json:"problems"`
}

// StaffImportCounts counts the rows per status.
type StaffImportCounts struct {
	New       int `json:"new"`
	Complete  int `json:"complete"`
	Duplicate int `json:"duplicate"`
	Conflict  int `json:"conflict"`
	Invalid   int `json:"invalid"`
	Imported  int `json:"imported"`
}

// StaffImport is the answer to a look at a file: how it was read, the
// mapping used and every row.
type StaffImport struct {
	Encoding  string             `json:"encoding"`
	Delimiter string             `json:"delimiter"`
	Headers   []string           `json:"headers"`
	Mapping   StaffImportMapping `json:"mapping"`
	// Unmapped names the required fields without a column; the rows are
	// read once each has one.
	Unmapped    []string          `json:"unmapped"`
	Fingerprint string            `json:"fingerprint,omitempty"`
	Applied     bool              `json:"applied"`
	Counts      StaffImportCounts `json:"counts"`
	Rows        []StaffImportRow  `json:"rows"`
}

// StaffImportEntry is one import in the log: when, by whom, which file,
// how many records it created and how many it completed.
type StaffImportEntry struct {
	File      string `json:"file"`
	AccountID int64  `json:"account_id"`
	// ByYou marks the reader's own import; AccountName names a colleague's
	// with the name the colleague carries at the Träger, empty without one.
	ByYou       bool      `json:"by_you"`
	AccountName string    `json:"account_name,omitempty"`
	ImportedAt  time.Time `json:"imported_at"`
	Created     int       `json:"created"`
	Completed   int       `json:"completed"`
}

// TraegerStaffImports is the Personal-Import of the Personalstamm. Each
// call checks the release; the route checks the right „Personal“.
type TraegerStaffImports interface {
	// ImportStaff reads a file with the mapping and answers every row; with
	// Apply it stores the new and complete rows in one Träger transaction.
	ImportStaff(ctx context.Context, actor TraegerStaffActor, request StaffImportRequest) (StaffImport, error)
	// StaffImportLog lists the imports of the Träger, newest first.
	StaffImportLog(ctx context.Context, actor TraegerStaffActor) ([]StaffImportEntry, error)
}
