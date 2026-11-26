package application

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

var _ traegerview.ChildDirectory = (*Overview)(nil)

func childrenPortsBound(ports traegerview.ChildrenPorts) bool {
	return ports.Names != nil && ports.Placements != nil
}

// Children returns one page of the children of the Träger by name (#8137,
// ADR 0327). Every owner is read once for the school set, so a page costs
// the same statements for 3 and for 100 schools. The names are personal
// data: the access log of each school with a row on the page records the
// read (ADR 0084 section 7).
func (o *Overview) Children(ctx context.Context, viewer traegerview.Viewer, filter traegerview.ChildrenFilter) (traegerview.TraegerChildren, error) {
	filter, err := validChildrenFilter(viewer, filter)
	if err != nil {
		return traegerview.TraegerChildren{}, err
	}
	cursor, err := decodeChildrenCursor(filter.Cursor)
	if err != nil {
		return traegerview.TraegerChildren{}, err
	}
	day := calendar.DateFromTime(o.now())
	if !cursor.Day.IsZero() && cursor.Day != day {
		return traegerview.TraegerChildren{}, readstate.ErrChanged
	}
	result := traegerview.TraegerChildren{RosterDate: day, Schools: []traegerview.SchoolChildCount{}, Children: []traegerview.TraegerChild{}}
	err = o.read(ctx, viewer.OrganizationID, func(adminCtx context.Context, ids []int64) error {
		listed, err := o.listedChildren(adminCtx, ids, filter, day)
		if err != nil {
			return err
		}
		result.Schools, result.Total = listed.schoolCounts(), len(listed.students)
		names, matched, err := o.children.Names.StudentNamesByTenant(adminCtx, listed.scope, traegerview.StudentNameQuery{
			Students: listed.students, Search: filter.Search, Limit: traegerview.ChildrenPageSize + 1,
			After: traegerview.StudentName{StudentProfileID: cursor.ID, FirstName: cursor.FirstName, LastName: cursor.LastName},
		})
		if err != nil {
			return err
		}
		if len(names) > traegerview.ChildrenPageSize {
			names = names[:traegerview.ChildrenPageSize]
			next, err := encodeChildrenCursor(names[len(names)-1], cursor.Page+1, day)
			if err != nil {
				return err
			}
			result.NextCursor = next
		}
		result.Matched = matched
		result.Children, err = o.placedChildren(adminCtx, listed, names)
		return err
	})
	if err != nil {
		return traegerview.TraegerChildren{}, err
	}
	if err := o.record(ctx, viewer, traegerview.ResourceTypeTraegerChildren, childrenDayWindow(day), childSchools(result.Children), "list", cursor.Page); err != nil {
		return traegerview.TraegerChildren{}, err
	}
	return result, nil
}

// ChildrenExport returns every child of the filter for the file. It is a
// read of the same names, so each school with a row records it.
func (o *Overview) ChildrenExport(ctx context.Context, viewer traegerview.Viewer, filter traegerview.ChildrenFilter, rosterDate calendar.Date) (traegerview.ChildrenExport, error) {
	filter, err := validChildrenFilter(viewer, filter)
	if err != nil {
		return traegerview.ChildrenExport{}, err
	}
	day := calendar.DateFromTime(o.now())
	if rosterDate != day {
		return traegerview.ChildrenExport{}, readstate.ErrChanged
	}
	result := traegerview.ChildrenExport{Search: filter.Search, Children: []traegerview.TraegerChild{}}
	err = o.read(ctx, viewer.OrganizationID, func(adminCtx context.Context, ids []int64) error {
		listed, err := o.listedChildren(adminCtx, ids, filter, day)
		if err != nil {
			return err
		}
		if filter.SchoolID > 0 {
			result.SchoolName = listed.schoolNames[filter.SchoolID]
		}
		names, _, err := o.children.Names.StudentNamesByTenant(adminCtx, listed.scope, traegerview.StudentNameQuery{Students: listed.students, Search: filter.Search})
		if err != nil {
			return err
		}
		result.Children, err = o.placedChildren(adminCtx, listed, names)
		return err
	})
	if err != nil {
		return traegerview.ChildrenExport{}, err
	}
	if err := o.record(ctx, viewer, traegerview.ResourceTypeTraegerChildrenExport, childrenDayWindow(day), childSchools(result.Children), "export", 0); err != nil {
		return traegerview.ChildrenExport{}, err
	}
	return result, nil
}

// childrenCursor holds a sort boundary even if its child leaves the roster.
type childrenCursor struct {
	LastName  string        `json:"last"`
	FirstName string        `json:"first"`
	ID        int64         `json:"id"`
	Page      int           `json:"page"`
	Day       calendar.Date `json:"day"`
}

func encodeChildrenCursor(last traegerview.StudentName, page int, day calendar.Date) (string, error) {
	raw, err := json.Marshal(childrenCursor{
		LastName: last.LastName, FirstName: last.FirstName, ID: last.StudentProfileID, Page: page, Day: day,
	})
	if err != nil {
		return "", fmt.Errorf("traeger view: encode children cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeChildrenCursor(token string) (childrenCursor, error) {
	if token == "" {
		return childrenCursor{Page: 1}, nil
	}
	invalid := fmt.Errorf("%w: invalid cursor", traegerview.ErrInvalidChildrenFilter)
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return childrenCursor{}, invalid
	}
	var cursor childrenCursor
	if json.Unmarshal(raw, &cursor) != nil || cursor.ID <= 0 || cursor.Page < 2 || cursor.Page == math.MaxInt || cursor.Day.IsZero() ||
		strings.ContainsRune(cursor.LastName, 0) || strings.ContainsRune(cursor.FirstName, 0) {
		return childrenCursor{}, invalid
	}
	return cursor, nil
}

// validChildrenFilter trims the search and refuses a filter outside its
// bounds.
func validChildrenFilter(viewer traegerview.Viewer, filter traegerview.ChildrenFilter) (traegerview.ChildrenFilter, error) {
	if viewer.OrganizationID <= 0 || viewer.AccountID <= 0 {
		return filter, traegerview.ErrTraegerRequired
	}
	filter.Search = strings.TrimSpace(filter.Search)
	switch {
	case filter.SchoolID < 0:
		return filter, fmt.Errorf("%w: negative school", traegerview.ErrInvalidChildrenFilter)
	case strings.ContainsRune(filter.Search, 0):
		return filter, fmt.Errorf("%w: the search contains a NUL byte", traegerview.ErrInvalidChildrenFilter)
	case len([]rune(filter.Search)) > traegerview.ChildrenSearchMaxLength:
		return filter, fmt.Errorf("%w: the search exceeds %d characters", traegerview.ErrInvalidChildrenFilter, traegerview.ChildrenSearchMaxLength)
	}
	return filter, nil
}

// The audit range covers the same Berlin day as the roster.
func childrenDayWindow(day calendar.Date) window {
	return window{from: day.BerlinMidnight(), to: day.AddDays(1).BerlinMidnight()}
}

// listedChildren are the children the schools of the Träger count today and
// the part of them a filter lists.
type listedChildren struct {
	schools     []traegerview.TraegerSchool
	schoolNames map[int64]string
	roster      map[int64]map[int64]int64
	// scope are the schools of the filter, students their counted children
	// and memberships the membership of each of those.
	scope       []int64
	students    []int64
	memberships map[int64]int64
}

// listedChildren reads the schools of the Träger and their rosters and
// narrows them to the filter's school. A school outside ids is
// ErrSchoolOutsideTraeger.
func (o *Overview) listedChildren(adminCtx context.Context, ids []int64, filter traegerview.ChildrenFilter, day calendar.Date) (listedChildren, error) {
	if filter.SchoolID > 0 && !slices.Contains(ids, filter.SchoolID) {
		return listedChildren{}, traegerview.ErrSchoolOutsideTraeger
	}
	schools, err := o.rows.Schools(adminCtx, ids)
	if err != nil {
		return listedChildren{}, err
	}
	roster, err := o.rosters.ActiveStudentMembershipsByTenant(adminCtx, ids, day.BerlinMidnight())
	if err != nil {
		return listedChildren{}, err
	}
	listed := listedChildren{schools: schools, schoolNames: make(map[int64]string, len(schools)), roster: roster, scope: ids, memberships: map[int64]int64{}}
	for _, school := range schools {
		listed.schoolNames[school.ID.Int64()] = school.Name
	}
	if filter.SchoolID > 0 {
		listed.scope = []int64{filter.SchoolID}
	}
	for _, school := range listed.scope {
		for student, membership := range roster[school] {
			listed.students = append(listed.students, student)
			listed.memberships[student] = membership
		}
	}
	slices.Sort(listed.students)
	return listed, nil
}

// schoolCounts lists every school with the number of children it counts.
func (l listedChildren) schoolCounts() []traegerview.SchoolChildCount {
	counts := make([]traegerview.SchoolChildCount, 0, len(l.schools))
	for _, school := range l.schools {
		counts = append(counts, traegerview.SchoolChildCount{TraegerSchool: school, Children: len(l.roster[school.ID.Int64()])})
	}
	return counts
}

// placedChildren gives each name its school, its school class and its OGS
// group, in the order of names. It reads the placements of exactly these
// children and the group names of exactly their schools.
func (o *Overview) placedChildren(adminCtx context.Context, listed listedChildren, names []traegerview.StudentName) ([]traegerview.TraegerChild, error) {
	children := make([]traegerview.TraegerChild, 0, len(names))
	if len(names) == 0 {
		return children, nil
	}
	schools, memberships := []int64{}, make([]int64, 0, len(names))
	for _, name := range names {
		if !slices.Contains(schools, name.SchoolID) {
			schools = append(schools, name.SchoolID)
		}
		memberships = append(memberships, listed.memberships[name.StudentProfileID])
	}
	classes, groups, err := o.children.Placements.MembershipPlacementsByTenant(adminCtx, schools, memberships)
	if err != nil {
		return nil, err
	}
	groupNames := map[int64]string{}
	if len(groups) > 0 {
		named, err := o.occupancy.GroupNames.GroupsByTenant(adminCtx, schools)
		if err != nil {
			return nil, err
		}
		for _, ofSchool := range named {
			for _, group := range ofSchool {
				groupNames[group.ID] = group.Name
			}
		}
	}
	for _, name := range names {
		membership := listed.memberships[name.StudentProfileID]
		children = append(children, traegerview.TraegerChild{
			StudentID: ident.ID(name.StudentProfileID), SchoolID: ident.ID(name.SchoolID), SchoolName: listed.schoolNames[name.SchoolID],
			FirstName: name.FirstName, LastName: name.LastName, SchoolClass: classes[membership], GroupName: groupNames[groups[membership]],
		})
	}
	return children, nil
}

func childSchools(children []traegerview.TraegerChild) map[int64]int {
	counts := map[int64]int{}
	for _, child := range children {
		counts[child.SchoolID.Int64()]++
	}
	return counts
}
