package communication

import (
	"context"
	"time"
)

// The school-year change moves the class targets of the parent channels with
// the children (#8214), like the class teachers and the class lists: the
// thread of the 3a becomes the thread of the 4a and keeps its families, a
// thread of a class that leaves is closed, and a draft announcement to the 3a
// goes to the 4a. Messages already sent keep the recipients they reached.
const (
	ParentClassTargetGroupThread       = "group_thread"
	ParentClassTargetAnnouncementDraft = "announcement_draft"
)

// ParentClassRename is one class of a school-year change. A nil ToClass means
// the class leaves the school.
type ParentClassRename struct {
	FromClass string
	ToClass   *string
}

// ParentClassTarget is an open class thread or a draft announcement that
// writes to a class, as the preview of a school-year change lists it.
type ParentClassTarget struct {
	Kind  string
	ID    int64
	Title string
	Class string
}

// ParentGroupClassMove is the newest school-year change that moved a class
// thread. A nil ToClass means the class left and the change closed the thread.
type ParentGroupClassMove struct {
	TransitionID int64   `json:"transition_id"`
	FromClass    string  `json:"from_class"`
	ToClass      *string `json:"to_class"`
}

// ParentClassTransitions is the communication side of a school-year change.
// Every method runs in the caller's school transaction; the grade transition
// workflow calls it under its own locks, after the children changed class.
// Classes match like the audience does: trimmed and case-insensitive.
type ParentClassTransitions interface {
	ListParentClassTargets(ctx context.Context, classes []string) ([]ParentClassTarget, error)
	// FollowParentClassRenames moves the open class threads and the class
	// targets of draft announcements and records each move under the
	// transition. closedBy and closedAt stamp the closing of a leaving
	// class's thread.
	FollowParentClassRenames(ctx context.Context, transitionID, closedBy int64, closedAt time.Time, renames []ParentClassRename) error
	// RevertParentClassRenames undoes exactly what the transition moved.
	RevertParentClassRenames(ctx context.Context, transitionID int64) error
}
