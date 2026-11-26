package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
)

// NewSchoolStudentNames reads on the caller's administrative transaction.
func NewSchoolStudentNames(database func(context.Context) (bun.IDB, TenantScope, error)) peopledirectory.SchoolStudentNames {
	return studentNames{database: database}
}

type studentNames struct {
	database func(context.Context) (bun.IDB, TenantScope, error)
}

// studentNameSearch is the search text as a substring pattern.
const studentNameSearch = `'%' || ` + collation.UnaccentLikePatternSQL + ` || '%' ESCAPE '\'`

// studentNamesSQL takes the school set, the student profiles, the search
// text four times, the limit (NULL for none) and the offset. A name matches
// as "first last", as "last first" and as the list shows it, "last, first".
// The name columns carry the German collation, so the order needs none of
// its own.
// The statement holds what a person typed, so the query log redacts its
// literals.
const studentNamesSQL = collation.RedactLiteralsInLog + `SELECT profile.tenant_id, profile.id, person.first_name, person.last_name, count(*) OVER () AS matched
FROM users.student_profiles AS profile
JOIN users.persons AS person
  ON person.tenant_id = profile.tenant_id AND person.id = profile.person_id AND person.deleted_at IS NULL
WHERE profile.tenant_id = ANY(?) AND profile.id = ANY(?)
  AND (? = ''
    OR public.f_unaccent(person.first_name || ' ' || person.last_name) ILIKE ` + studentNameSearch + `
    OR public.f_unaccent(person.last_name || ' ' || person.first_name) ILIKE ` + studentNameSearch + `
    OR public.f_unaccent(person.last_name || ', ' || person.first_name) ILIKE ` + studentNameSearch + `)
ORDER BY person.last_name, person.first_name, profile.id
LIMIT ? OFFSET ?`

// StudentNamesByTenant lists one page of the names of the given student
// profiles of the schools, with the number of all matches, in one statement.
func (s studentNames) StudentNamesByTenant(ctx context.Context, schools []int64, query peopledirectory.SchoolStudentNameQuery) ([]peopledirectory.SchoolStudentName, int, error) {
	result := []peopledirectory.SchoolStudentName{}
	if len(schools) == 0 || len(query.StudentProfileIDs) == 0 {
		return result, 0, nil
	}
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, 0, err
	}
	if !scope.AcrossSchools {
		return nil, 0, errors.New("people directory: student names need the administrative transaction")
	}
	var limit *int
	if query.Limit > 0 {
		limit = &query.Limit
	}
	var rows []struct {
		TenantID  int64  `bun:"tenant_id"`
		ID        int64  `bun:"id"`
		FirstName string `bun:"first_name"`
		LastName  string `bun:"last_name"`
		Matched   int    `bun:"matched"`
	}
	if err := db.NewRaw(studentNamesSQL, pgdialect.Array(schools), pgdialect.Array(query.StudentProfileIDs), query.Search, query.Search, query.Search, query.Search, limit, query.Offset).
		Scan(ctx, &rows); err != nil {
		return nil, 0, fmt.Errorf("people directory postgres: student names: %w", err)
	}
	matched := 0
	for _, row := range rows {
		matched = row.Matched
		result = append(result, peopledirectory.SchoolStudentName{SchoolID: row.TenantID, StudentProfileID: row.ID, FirstName: row.FirstName, LastName: row.LastName})
	}
	return result, matched, nil
}
