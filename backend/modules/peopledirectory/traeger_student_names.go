package peopledirectory

import "context"

// SchoolStudentName is the name of one student profile of a school.
type SchoolStudentName struct {
	SchoolID         int64
	StudentProfileID int64
	FirstName        string
	LastName         string
}

// SchoolStudentNameQuery selects names among the given student profiles: those a
// part of whose "first last" or "last first" matches Search without case and
// accents (empty for all), ordered by last name, first name and profile ID,
// Limit of them (0 for all) after Offset.
type SchoolStudentNameQuery struct {
	StudentProfileIDs []int64
	Search            string
	Limit             int
	Offset            int
}

// SchoolStudentNames answers the Träger-Büro's list of the children of its schools
// (#8137, ADR 0327): the names of the given student profiles of the given
// schools, one page of them. It says nothing about the membership; the
// caller names the profiles that count. matched counts every profile the
// query matches, whatever Limit and Offset, and is 0 when the page holds no
// name.
//
// The caller must run it in the administrative transaction; it reads only
// the given schools.
type SchoolStudentNames interface {
	StudentNamesByTenant(ctx context.Context, schools []int64, query SchoolStudentNameQuery) (names []SchoolStudentName, matched int, err error)
}
