package schoolmembership

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type StudentEnrollment struct {
	StudentID     int64
	GroupID       *int64
	SchoolClass   string
	Status        string
	EnrolledFrom  string
	EnrolledUntil string
	// WithoutCarePlace marks a child of the class without an OGS place
	// (#4803, ADR 0282). Such a child has no group and counts for neither
	// the Stichtagszahl nor the Kinderkontingent.
	WithoutCarePlace bool
}

// PendingWindows moves the enrollment window of a child an approval left
// pending, for a phase edit (#6505, ADR 0202). MovePendingWindow locks only
// the child's row, takes no class gate and reports whether the child was
// still pending. It raises no Kontingentzahl: a pending start that lies ahead
// counts already, one that moves to the past no longer.
type PendingWindows interface {
	MovePendingWindow(context.Context, PendingWindowMove) (bool, error)
}

// PendingWindowMove moves the enrollment window of a still pending child with
// the service window its approval planned (#6505). A bound that still equals
// its Before value takes its After value. A bound that equals the start or
// end of one of the child's approvals in another phase (OtherStarts,
// OtherEnds) takes the After value only when that widens the window. Any
// other bound came from a manual change and stays.
type PendingWindowMove struct {
	StudentID   int64
	FromBefore  calendar.Date
	FromAfter   calendar.Date
	UntilBefore calendar.Date
	UntilAfter  calendar.Date
	OtherStarts []calendar.Date
	OtherEnds   []calendar.Date
}
