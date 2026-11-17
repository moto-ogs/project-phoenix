package application

import (
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
)

// The versions below fingerprint an exception a pickup approval wrote, as the
// approval's transaction left it. The decision ledger stores them, and a
// correction takes a row back only while its fingerprint is still equal: any
// later write, whatever its transaction's start time, counts as a change after
// the decision (ADR 0281, point 4). Exceptions include updated_at, which
// every writer advances (column default, trigger), plus every field a staff
// edit can change.

func pickupExceptionVersion(row careplan.PickupException) string {
	return rowVersion(stamp(row.UpdatedAt), clockText(row.PickupTime), optionalText(row.Reason),
		clockText(row.ExcusedFrom), optionalText(row.ExcusedReason), optionalID(row.ExcusedCreatedBy),
		strconv.FormatBool(row.ExcusedOwnsPickupTime), strconv.FormatBool(row.ExcusedAuto),
		row.Source, strconv.FormatInt(row.CreatedBy, 10), optionalID(row.CreatedByGuardian))
}

func departureExceptionVersion(row careplan.DepartureException) string {
	return rowVersion(stamp(row.UpdatedAt), row.DepartureMode, optionalText(row.Reason), optionalID(row.CreatedBy))
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
