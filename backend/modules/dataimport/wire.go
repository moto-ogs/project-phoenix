package dataimport

import "time"

// The wire results of the four file imports (#2352). The contract names an
// instance of a generic type for the type, so ImportResult[T] and
// ImportError[T] of two imports would collide; each import names its own
// result and row error, with the JSON names of ImportResult.

// StudentImportError is a row of a student import with its findings.
type StudentImportError ImportError[StudentImportRow]

// StudentImportResult is the answer of a student import.
type StudentImportResult struct {
	ImportSummary
	Errors []StudentImportError `json:"errors"`
}

// SchoolStaffImportRow is a staff row on the wire. Workforce's Träger staff
// import already holds the name StaffImportRow in the contract.
type SchoolStaffImportRow StaffImportRow

// StaffImportError is a row of a staff import with its findings.
type StaffImportError struct {
	RowNumber int                  `json:"row_number"`
	Data      SchoolStaffImportRow `json:"data"`
	Errors    []ValidationError    `json:"errors"`
	Timestamp time.Time            `json:"timestamp"`
}

// StaffImportResult is the answer of a staff import.
type StaffImportResult struct {
	ImportSummary
	Errors []StaffImportError `json:"errors"`
}

// ClassListImportError is a row of a class-list import with its findings.
type ClassListImportError ImportError[ClassListEntryImportRow]

// ClassListImportResult is the answer of a class-list import.
type ClassListImportResult struct {
	ImportSummary
	Errors []ClassListImportError `json:"errors"`
}

// OpeningBalanceImportError is a row of an opening-balance import with its
// findings.
type OpeningBalanceImportError ImportError[OpeningBalanceImportRow]

// OpeningBalanceImportResult is the answer of an opening-balance import.
type OpeningBalanceImportResult struct {
	ImportSummary
	Errors []OpeningBalanceImportError `json:"errors"`
}

// NewStudentImportResult names the rows of a student import's result.
func NewStudentImportResult(result *ImportResult[StudentImportRow]) StudentImportResult {
	summary, errs := wireOf(result, func(e ImportError[StudentImportRow]) StudentImportError { return StudentImportError(e) })
	return StudentImportResult{ImportSummary: summary, Errors: errs}
}

// NewStaffImportResult names the rows of a staff import's result.
func NewStaffImportResult(result *ImportResult[StaffImportRow]) StaffImportResult {
	summary, errs := wireOf(result, func(e ImportError[StaffImportRow]) StaffImportError {
		return StaffImportError{RowNumber: e.RowNumber, Data: SchoolStaffImportRow(e.Data), Errors: e.Errors, Timestamp: e.Timestamp}
	})
	return StaffImportResult{ImportSummary: summary, Errors: errs}
}

// NewClassListImportResult names the rows of a class-list import's result.
func NewClassListImportResult(result *ImportResult[ClassListEntryImportRow]) ClassListImportResult {
	summary, errs := wireOf(result, func(e ImportError[ClassListEntryImportRow]) ClassListImportError { return ClassListImportError(e) })
	return ClassListImportResult{ImportSummary: summary, Errors: errs}
}

// NewOpeningBalanceImportResult names the rows of an opening-balance
// import's result.
func NewOpeningBalanceImportResult(result *ImportResult[OpeningBalanceImportRow]) OpeningBalanceImportResult {
	summary, errs := wireOf(result, func(e ImportError[OpeningBalanceImportRow]) OpeningBalanceImportError {
		return OpeningBalanceImportError(e)
	})
	return OpeningBalanceImportResult{ImportSummary: summary, Errors: errs}
}

// wireOf converts a result's row errors; the lists are never null on the
// wire, so a client reads an empty list for a clean file.
func wireOf[T, E any](result *ImportResult[T], to func(ImportError[T]) E) (ImportSummary, []E) {
	if result == nil {
		return ImportSummary{BulkActions: []BulkAction{}}, []E{}
	}
	summary := result.ImportSummary
	if summary.BulkActions == nil {
		summary.BulkActions = []BulkAction{}
	}
	errs := make([]E, 0, len(result.Errors))
	for _, e := range result.Errors {
		errs = append(errs, to(e))
	}
	return summary, errs
}
