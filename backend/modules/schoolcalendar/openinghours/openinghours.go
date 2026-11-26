// Package openinghours is School Calendar's contract for the changed
// opening hours of a school on single days (#7654). The routes beside the
// closing days serve it; the values are those of the public capability.
package openinghours

import "github.com/moto-ogs/project-phoenix/modules/schoolcalendar"

type (
	// Change is one range of days with other opening hours.
	Change = schoolcalendar.OpeningChange
	// Input is a change as the school writes it.
	Input = schoolcalendar.OpeningChangeInput
	// Changes maintains the changes of the school of the tenant transaction.
	Changes = schoolcalendar.OpeningChanges
	// InvalidError names the field a change fails on.
	InvalidError = schoolcalendar.InvalidOpeningChangeError
)

var (
	// ErrNotFound reports a change missing in the school of the transaction.
	ErrNotFound = schoolcalendar.ErrOpeningChangeNotFound
	// ErrInvalid reports a change that is none.
	ErrInvalid = schoolcalendar.ErrInvalidOpeningChange
)
