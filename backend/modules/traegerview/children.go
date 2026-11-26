package traegerview

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The children of the Träger (#8137, ADR 0327): every child the schools of
// the Träger count today, by name, with its school, its school class and its
// OGS group. The Träger-Büro finds a child without switching into each
// school.
//
// The binding definitions:
//
//   - Listed are the children of the Stichtagszahl rule of today (#2791), the
//     same children as "Kinder gesamt" of the school view and the occupancy.
//     A child that left, has no care place or waits for its start is missing.
//   - A child stands under the school that counts it. A holiday guest stands
//     under its host school with the class School Membership gives it.
//   - The list is ordered by last name, first name and ID, in the German
//     order of the name columns.
//   - The search matches a part of "first last", "last first" or "last,
//     first" as the list shows a name, without case and accents.
//   - A row names the child and where it is cared for, nothing else: no date
//     of birth, no address, no health or support information, no contract.

// ChildrenPageSize is the number of children on one page of the list.
const ChildrenPageSize = 50

// ChildrenSearchMaxLength bounds the search text of the list.
const ChildrenSearchMaxLength = 100

// The access log entries of the list at each school it shows: the rows on
// the screen and the file.
const (
	ResourceTypeTraegerChildren       = "traeger_children"
	ResourceTypeTraegerChildrenExport = "traeger_children_export"
)

// ErrInvalidChildrenFilter reports a negative school or offset or a search
// text over ChildrenSearchMaxLength.
var ErrInvalidChildrenFilter = errors.New("traeger view: invalid filter for the children")

// ChildrenFilter selects children: of one school of the Träger (SchoolID, 0
// for all of them) and by a part of the name (Search, empty for all). Offset
// is the number of children before the page; the export ignores it.
type ChildrenFilter struct {
	SchoolID int64
	Search   string
	Offset   int
}

// TraegerChild is one child of a school of the Träger. SchoolClass and GroupName
// are empty without one.
type TraegerChild struct {
	StudentID   ident.ID `json:"student_id"`
	SchoolID    ident.ID `json:"school_id"`
	SchoolName  string   `json:"school_name"`
	FirstName   string   `json:"first_name"`
	LastName    string   `json:"last_name"`
	SchoolClass string   `json:"school_class"`
	GroupName   string   `json:"group_name"`
}

// SchoolChildCount is one school of the Träger with the number of children it
// counts today. It names no child.
type SchoolChildCount struct {
	TraegerSchool
	Children int `json:"children"`
}

// TraegerChildren is one page of the children of the Träger. Schools lists every
// school of the Träger, ordered by name, also one without a child and
// whatever the filter. Total counts the children of the filter's school, or
// of all schools; Matched counts those of them the search matches and is 0
// on a page behind the last child.
type TraegerChildren struct {
	Schools  []SchoolChildCount `json:"schools"`
	Total    int                `json:"total"`
	Matched  int                `json:"matched"`
	Children []TraegerChild     `json:"children"`
	HasMore  bool               `json:"has_more"`
}

// ChildrenExport is the file of the list: every child of the filter, and the
// name of the filter's school, empty for all schools.
type ChildrenExport struct {
	SchoolName string
	Search     string
	Children   []TraegerChild
}

// StudentName is the name of one student profile of a school, at People
// Directory.
type StudentName struct {
	SchoolID         int64
	StudentProfileID int64
	FirstName        string
	LastName         string
}

// StudentNameQuery selects names among the given student profiles: those a
// part of whose name matches Search (empty for all), ordered by last name,
// first name and ID, Limit of them (0 for all) after Offset.
type StudentNameQuery struct {
	Students []int64
	Search   string
	Limit    int
	Offset   int
}

// StudentNames names student profiles of the schools, at People Directory.
// matched counts every profile the query matches, whatever Limit and Offset,
// and is 0 when the page holds no name. It joins the projection's
// administrative transaction and reads only the given schools.
type StudentNames interface {
	StudentNamesByTenant(ctx context.Context, schools []int64, query StudentNameQuery) (names []StudentName, matched int, err error)
}

// StudentPlacements reads where the given memberships are cared for, at
// School Membership: membership ID to school class and to OGS group ID. A
// membership without a class or a group is missing from that map. It joins
// the projection's administrative transaction and reads only the given
// schools.
type StudentPlacements interface {
	MembershipPlacementsByTenant(ctx context.Context, schools, memberships []int64) (classes map[int64]string, groups map[int64]int64, err error)
}

// ChildrenPorts are the owners' reads behind the children of the Träger
// beside the roster of the school view and the group names of the
// occupancy.
type ChildrenPorts struct {
	Names      StudentNames
	Placements StudentPlacements
}

// ChildDirectory answers the children of the Träger-Portal (#8137, ADR
// 0327). It stands apart from Overview so that each facade stays small
// (#2580).
type ChildDirectory interface {
	// Children returns one page of the children of the Träger. A school of
	// another Träger is ErrSchoolOutsideTraeger, a filter outside its bounds
	// ErrInvalidChildrenFilter. The access log of each school with a row on
	// the page records the read with the viewer's account.
	Children(ctx context.Context, viewer Viewer, filter ChildrenFilter) (TraegerChildren, error)
	// ChildrenExport returns every child of the filter for the file. The
	// access log of each school with a row records the export with the
	// viewer's account.
	ChildrenExport(ctx context.Context, viewer Viewer, filter ChildrenFilter) (ChildrenExport, error)
}
