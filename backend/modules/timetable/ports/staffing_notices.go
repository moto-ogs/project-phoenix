package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The kinds of a staffing change a notice tells about (#7136).
const (
	// StaffingChangeSubstituted: SubstituteName covers SubjectName.
	StaffingChangeSubstituted = "substituted"
	// StaffingChangeAbsent: SubjectName is not there, without cover.
	StaffingChangeAbsent = "absent"
	// StaffingChangePresent: SubjectName is there after all.
	StaffingChangePresent = "present"
	// StaffingChangeSubstituteRemoved: SubjectName no longer substitutes.
	StaffingChangeSubstituteRemoved = "substitute_removed"
)

// StaffingNotice tells the people concerned and the teachers of the affected
// OGS groups about one story in a staffing operation (#7136): a single save,
// a Sammel-Vertretung or one absence's plan cascade. It never carries
// the reason of an absence. The person who made the change is in none of the
// account lists. Push is false when the change takes effect more than 14
// days ahead; such a notice reaches the notification feed only.
type StaffingNotice struct {
	Kind string
	// ObjectType and ObjectID name the independently visible story; changes
	// of the same object within the bundle window update one unread entry.
	ObjectType string
	ObjectID   int64
	// SubjectName is the absent, present or removed person; SubstituteName
	// the person who covers, for StaffingChangeSubstituted only.
	SubjectName    string
	SubstituteName string
	// Days are the affected days, ascending and distinct.
	Days []calendar.Date
	// InstanceID is the first affected block, the one the teachers' link
	// opens.
	InstanceID           int64
	SubjectAccountIDs    []int64
	SubstituteAccountIDs []int64
	TeacherAccountIDs    []int64
	// TeamAccountIDs reach the rest of the team of the affected groups
	// (#7138) about an absence or a return. A team notice carries no other
	// audience, and the other notices carry no team.
	TeamAccountIDs []int64
	Push           bool
}

// StaffingNotices is the consumer-owned port to Delivery's notification feed
// for staffing changes. It writes in the caller's transaction, so the notice
// commits or rolls back with the change.
type StaffingNotices interface {
	NotifyStaffingChanged(ctx context.Context, notice StaffingNotice) error
}

// GroupTeacherStaff names the staff members assigned as teachers to each of
// the given OGS groups; a group without teachers is absent.
type GroupTeacherStaff interface {
	GroupTeacherStaffIDs(ctx context.Context, groupIDs []int64) (map[int64][]int64, error)
}

// StaffingBlockGroups names the OGS groups of each block, as the
// Betreuungsplan's group filter shows them (timetable.BlockGroupQuery).
type StaffingBlockGroups interface {
	BlockEducationGroups(ctx context.Context, instanceIDs []int64) (map[int64][]int64, error)
}

// GroupHandover is a Gruppenübergabe: StaffID holds GroupID on the days
// From to To, inclusive.
type GroupHandover struct {
	GroupID, StaffID int64
	From, To         calendar.Date
}

// GroupHandoverStaff lists the Gruppenübergaben of the given OGS groups that
// overlap the days from to to. With the assigned teachers they are the team
// of a group on a day, as "my groups" of a caller name it (#7138).
type GroupHandoverStaff interface {
	GroupHandovers(ctx context.Context, groupIDs []int64, from, to calendar.Date) ([]GroupHandover, error)
}

// StaffingNoticeDependencies wires the staffing notices of the deviation
// writes. Without Notices nobody is told; Groups, Teachers and Handovers
// are then unused, and otherwise all are required.
type StaffingNoticeDependencies struct {
	Notices   StaffingNotices
	Groups    StaffingBlockGroups
	Teachers  GroupTeacherStaff
	Handovers GroupHandoverStaff
}
