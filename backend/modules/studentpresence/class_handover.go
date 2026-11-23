package studentpresence

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ClassHandoverChange hands one class over to the OGS after lessons (#4794),
// attributed to the users.staff_school_memberships row of the Lehrkraft, or
// takes the handover of that class and date back (Withdraw). On a handover,
// PresentStudentIDs and AbsentStudentIDs are the children with an OGS record
// she handed over "da" and "nicht da"; either list may be empty.
// ExpectedVersion is the ClassHandoverVersion of the class and date its
// Lehrkraft read: a handover over another stored handover is refused with
// readstate.ErrChanged (ADR 0311). A withdrawal takes no version.
type ClassHandoverChange struct {
	SchoolClass       string
	Date              calendar.Date
	HandedOverBy      int64
	PresentStudentIDs []int64
	AbsentStudentIDs  []int64
	Withdraw          bool
	ExpectedVersion   string
}

// classHandoverState is the canonical form of the stored handover of one
// class and day in its version.
type classHandoverState struct {
	HandedOver          bool    `json:"handed_over"`
	HandedOverAt        string  `json:"handed_over_at"`
	HandedOverByStaffID int64   `json:"handed_over_by_staff_id"`
	PresentStudentIDs   []int64 `json:"present_student_ids"`
	AbsentStudentIDs    []int64 `json:"absent_student_ids"`
}

// ClassHandoverVersion is the read-state token of the handover of one class
// and day (ADR 0311); nil is a class not handed over yet. A new handover,
// another moment or another child "da" or "nicht da" changes it.
func ClassHandoverVersion(handover *ClassHandover) string {
	state := classHandoverState{PresentStudentIDs: []int64{}, AbsentStudentIDs: []int64{}}
	if handover != nil {
		state.HandedOver = true
		state.HandedOverAt = handover.HandedOverAt.UTC().Format(time.RFC3339Nano)
		state.HandedOverByStaffID = handover.HandedOverByStaffID
		state.PresentStudentIDs = append(state.PresentStudentIDs, handover.PresentStudentIDs...)
		state.AbsentStudentIDs = append(state.AbsentStudentIDs, handover.AbsentStudentIDs...)
		slices.Sort(state.PresentStudentIDs)
		slices.Sort(state.AbsentStudentIDs)
	}
	return readstate.Fingerprint(state)
}

// ClassHandover is the stored handover of one class and school day.
// HandedOverByStaffID is zero when the staff member was removed since.
type ClassHandover struct {
	SchoolClass         string
	Date                calendar.Date
	HandedOverAt        time.Time
	HandedOverByStaffID int64
	PresentStudentIDs   []int64
	AbsentStudentIDs    []int64
}

// ClassHandovers stores the handover of a class after lessons (#4794): when
// and by whom the Lehrkraft handed her class to the OGS, and which children
// she handed over "da" and "nicht da". The handover is a moment of its own: no method here reads
// or writes the morning attendance or the OGS attendance. Which children
// belong to the class and whether the caller may hand it over is decided by
// the caller before.
type ClassHandovers interface {
	// ClassHandoversOn returns every handover of date, each with its
	// children; a school day has at most one per class.
	ClassHandoversOn(ctx context.Context, date calendar.Date) ([]ClassHandover, error)
	// ChangeClassHandover stores a handover, replacing one of the same class
	// (matched trimmed and lowercased) and date with the new moment, staff
	// member and children, or deletes it on Withdraw. Under the class and
	// day's lock it refuses a handover whose ExpectedVersion is not the
	// stored handover's version with readstate.ErrChanged. It reports whether a
	// handover of the class and date existed before.
	// ErrClassHandoverInvalid refuses a change without class or date, a
	// handover without staff member, a child ID that is not positive, or a
	// child both "da" and "nicht da".
	ChangeClassHandover(ctx context.Context, in ClassHandoverChange) (bool, error)
}

// ErrClassHandoverInvalid refuses a malformed class handover.
var ErrClassHandoverInvalid = errors.New("class handover is invalid")
