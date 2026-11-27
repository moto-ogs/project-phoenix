package dataimport

import "context"

// ClassListEntryImportRow is one row of the class-list entry bulk import
// (#2382): the minimal Klassenlisteneintrag — name and school class, nothing
// else. Deliberately no guardians, birthday, group or schedule columns; a
// child needing any of those is a regular student import.
type ClassListEntryImportRow struct {
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	SchoolClass string `json:"school_class"`
}

// ClassListConverter converts the class-list entries of the school in
// context; changedBy is the account the change trail names and is required.
type ClassListConverter interface {
	ConvertClassListEntries(ctx context.Context, changedBy int64) error
}
