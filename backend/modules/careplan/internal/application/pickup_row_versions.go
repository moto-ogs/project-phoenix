package application

import (
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
)

// The versions below fingerprint a row a pickup approval wrote, as the
// approval's transaction left it. The decision ledger stores them, and a
// correction takes a row back only while its fingerprint is still equal: any
// later write, whatever its transaction's start time, counts as a change after
// the decision (ADR 0281, point 4). Each version holds updated_at to the
// microsecond plus every field a staff edit can change, so a writer that
// leaves updated_at alone is still caught by the content.

func pickupExceptionVersion(row careplan.PickupException) string {
	return rowVersion(stamp(row.UpdatedAt), row.ExceptionDate.String(), clockText(row.PickupTime), optionalText(row.Reason),
		clockText(row.ExcusedFrom), optionalText(row.ExcusedReason), optionalID(row.ExcusedCreatedBy),
		strconv.FormatBool(row.ExcusedOwnsPickupTime), strconv.FormatBool(row.ExcusedAuto),
		row.Source, strconv.FormatInt(row.CreatedBy, 10), optionalID(row.CreatedByGuardian))
}

func departureExceptionVersion(row careplan.DepartureException) string {
	return rowVersion(stamp(row.UpdatedAt), row.ExceptionDate.String(), row.DepartureMode, optionalText(row.Reason), optionalID(row.CreatedBy))
}

// pickupNoteVersion covers what the note editor (PUT
// /students/{id}/pickup-notes/{noteId}) writes: date or weekday and text.
func pickupNoteVersion(row careplan.PickupNote) string {
	return rowVersion(stamp(row.UpdatedAt), row.NoteDate.String(), strconv.Itoa(row.Weekday), row.Content,
		strconv.FormatInt(row.StudentID, 10), strconv.FormatInt(row.CreatedBy, 10))
}

// pickupPersonVersion covers what the staff day editor (PUT
// /students/{id}/pickup-persons/{date}) writes: the name, the contact and
// the author.
func pickupPersonVersion(row careplan.PickupPerson) string {
	return rowVersion(stamp(row.UpdatedAt), row.ExceptionDate.String(), row.Name, optionalID(row.GuardianProfileID),
		optionalID(row.CreatedBy), optionalID(row.RequestedByGuardian))
}

// rowVersion joins the fields to one canonical text. It stays readable in the
// ledger; a quoted list keeps any separator inside a value unambiguous.
func rowVersion(parts ...string) string {
	quoted := make([]string, len(parts))
	for i, part := range parts {
		quoted[i] = strconv.Quote(part)
	}
	return strings.Join(quoted, ",")
}

// stamp keeps the full microsecond precision PostgreSQL stores, independent
// of the scanned location.
func stamp(at time.Time) string { return strconv.FormatInt(at.UnixMicro(), 10) }

func clockText(at *time.Time) string {
	if at == nil {
		return "\x00"
	}
	return at.Format("15:04:05.000000")
}

func optionalText(value *string) string {
	if value == nil {
		return "\x00"
	}
	return *value
}

func optionalID(value *int64) string {
	if value == nil {
		return "\x00"
	}
	return strconv.FormatInt(*value, 10)
}
