package domain

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Rules of an opening change of a school (#7654): a range of days with an
// opening and a closing wall-clock time and a name.

const (
	// OpeningChangeMaxDays bounds one change: a school year at most.
	OpeningChangeMaxDays = 366
	// OpeningChangeWindowMaxDays bounds the window of a listing.
	OpeningChangeWindowMaxDays = 400
	wallClockLayout            = "15:04"
)

// OpeningChangeProblem names the field a change fails on.
type OpeningChangeProblem struct {
	Field  string
	Reason string
}

// OpeningChangeFields is a change as the school writes it.
type OpeningChangeFields struct {
	StartDate, EndDate calendar.Date
	OpensAt, ClosesAt  string
	Reason             string
}

// NormalizeOpeningChange trims the name and writes both times as "HH:MM";
// a change that is none returns its problem.
func NormalizeOpeningChange(fields OpeningChangeFields, reasonMaxLength int) (OpeningChangeFields, *OpeningChangeProblem) {
	fields.Reason = strings.TrimSpace(fields.Reason)
	if fields.Reason == "" {
		return fields, &OpeningChangeProblem{"reason", "reason is required"}
	}
	if utf8.RuneCountInString(fields.Reason) > reasonMaxLength {
		return fields, &OpeningChangeProblem{"reason", fmt.Sprintf("reason cannot exceed %d characters", reasonMaxLength)}
	}
	if problem := OpeningChangeRange(fields.StartDate, fields.EndDate, OpeningChangeMaxDays, "end_date"); problem != nil {
		return fields, problem
	}
	opens, problem := parseWallClock(fields.OpensAt, "opens_at")
	if problem != nil {
		return fields, problem
	}
	closes, problem := parseWallClock(fields.ClosesAt, "closes_at")
	if problem != nil {
		return fields, problem
	}
	if !opens.Before(closes) {
		return fields, &OpeningChangeProblem{"closes_at", "closes_at must be after opens_at"}
	}
	fields.OpensAt, fields.ClosesAt = opens.Format(wallClockLayout), closes.Format(wallClockLayout)
	return fields, nil
}

// OpeningChangeRange refuses a missing day, an end before the start and a
// range longer than maxDays; field names the end.
func OpeningChangeRange(from, to calendar.Date, maxDays int, field string) *OpeningChangeProblem {
	if from == "" || to == "" {
		return &OpeningChangeProblem{field, "start and end date are required"}
	}
	if to.Before(from) {
		return &OpeningChangeProblem{field, "end must not be before start"}
	}
	if from.DaysUntil(to) >= maxDays {
		return &OpeningChangeProblem{field, fmt.Sprintf("range cannot exceed %d days", maxDays)}
	}
	return nil
}

// parseWallClock reads "HH:MM" (or "HH:MM:SS") as a wall-clock time; it
// carries no day and no zone.
func parseWallClock(value, field string) (time.Time, *OpeningChangeProblem) {
	for _, layout := range []string{wallClockLayout, "15:04:05"} {
		if clock, err := time.Parse(layout, strings.TrimSpace(value)); err == nil {
			return clock, nil
		}
	}
	return time.Time{}, &OpeningChangeProblem{field, field + " must be a time HH:MM"}
}
