package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership/internal/domain"
)

// classListEntryOrdinalRow is one entry together with the input position it
// belongs to (ADR 0067 addendum of 2026-11-08, ID contract: assigned by input
// position, never by an assumed RETURNING order).
type classListEntryOrdinalRow struct {
	Ord int64 `bun:"ord"`
	classListEntryRow
}

const classListEntryColumns = `e.id, e.created_at, e.updated_at, e.tenant_id, e.first_name, e.last_name, e.school_class, e.created_by`

// CreateClassListEntries inserts the entries in input order in one statement.
// It writes the columns CreateClassListEntry writes (tenant, names, class,
// creator or NULL) and leaves id and both timestamps to their defaults, as
// the single insert does. The unique index refuses a taken name as there.
func (s *Store) CreateClassListEntries(ctx context.Context, fields []schoolmembership.ClassListEntryFields, createdBy []*int64) ([]schoolmembership.ClassListEntry, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	if scope.TenantID <= 0 {
		return nil, domain.OperationStats{}, errors.New("school membership postgres: tenant is required to create class list entries")
	}
	if len(fields) != len(createdBy) {
		return nil, domain.OperationStats{}, errors.New("school membership postgres: every class list entry needs its creator slot")
	}
	firsts, lasts, classes := classListEntryKeyColumns(fields)
	creators := make([]int64, len(createdBy))
	for i, creator := range createdBy {
		if creator != nil {
			creators[i] = *creator
		}
	}
	var rows []classListEntryOrdinalRow
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewRaw(`MERGE INTO users.class_list_entries AS e
		USING (SELECT * FROM unnest(?::text[], ?::text[], ?::text[], ?::bigint[]) WITH ORDINALITY AS k(first_name, last_name, school_class, created_by, ord) ORDER BY k.ord) AS s
		ON false
		WHEN NOT MATCHED THEN INSERT (tenant_id, first_name, last_name, school_class, created_by)
			VALUES (?, s.first_name, s.last_name, s.school_class, NULLIF(s.created_by, 0))
		RETURNING s.ord, `+classListEntryColumns,
		pgdialect.Array(firsts), pgdialect.Array(lasts), pgdialect.Array(classes), pgdialect.Array(creators), scope.TenantID).Scan(ctx, &rows)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, stats, wrapClassListEntryWriteError("create", err)
	}
	result := make([]schoolmembership.ClassListEntry, len(fields))
	seen := make([]bool, len(fields))
	for _, row := range rows {
		index := int(row.Ord) - 1
		if index < 0 || index >= len(fields) || seen[index] {
			return nil, stats, fmt.Errorf("school membership postgres: create class list entries: unexpected input position %d", row.Ord)
		}
		seen[index] = true
		result[index] = classListEntryToPublic(row.classListEntryRow)
	}
	if len(rows) != len(fields) {
		return nil, stats, fmt.Errorf("school membership postgres: create class list entries: %d of %d entries returned", len(rows), len(fields))
	}
	stats.Rows = int64(len(rows))
	return result, stats, nil
}

// MatchClassListEntries applies the name-and-class predicate of
// ListClassListEntries (NFC-normalized, case-folded, trimmed names; trimmed,
// case-folded class) to every key and returns the matches per key in the
// listing's order.
func (s *Store) MatchClassListEntries(ctx context.Context, keys []schoolmembership.ClassListEntryFields) ([][]schoolmembership.ClassListEntry, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	if scope.TenantID <= 0 {
		return nil, domain.OperationStats{}, errors.New("school membership postgres: tenant is required to match class list entries")
	}
	firsts, lasts, classes := classListEntryKeyColumns(keys)
	var rows []classListEntryOrdinalRow
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewRaw(`SELECT k.ord, `+classListEntryColumns+`
		FROM unnest(?::text[], ?::text[], ?::text[]) WITH ORDINALITY AS k(first_name, last_name, school_class, ord)
		JOIN users.class_list_entries AS e ON e.tenant_id = ?
			AND LOWER(NORMALIZE(BTRIM(e.first_name), NFC) COLLATE public.german_name) = LOWER(NORMALIZE(BTRIM(k.first_name), NFC) COLLATE public.german_name)
			AND LOWER(NORMALIZE(BTRIM(e.last_name), NFC) COLLATE public.german_name) = LOWER(NORMALIZE(BTRIM(k.last_name), NFC) COLLATE public.german_name)
			AND LOWER(BTRIM(e.school_class)) = LOWER(BTRIM(k.school_class))
		ORDER BY k.ord, LOWER(e.last_name) ASC, LOWER(e.first_name) ASC, e.id ASC`,
		pgdialect.Array(firsts), pgdialect.Array(lasts), pgdialect.Array(classes), scope.TenantID).Scan(ctx, &rows)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, stats, fmt.Errorf("school membership postgres: match class list entries: %w", err)
	}
	result := make([][]schoolmembership.ClassListEntry, len(keys))
	for i := range result {
		result[i] = []schoolmembership.ClassListEntry{}
	}
	for _, row := range rows {
		index := int(row.Ord) - 1
		if index < 0 || index >= len(keys) {
			return nil, stats, fmt.Errorf("school membership postgres: match class list entries: unexpected input position %d", row.Ord)
		}
		result[index] = append(result[index], classListEntryToPublic(row.classListEntryRow))
	}
	stats.Rows = int64(len(rows))
	return result, stats, nil
}

func classListEntryKeyColumns(fields []schoolmembership.ClassListEntryFields) (firsts, lasts, classes []string) {
	firsts, lasts, classes = make([]string, len(fields)), make([]string, len(fields)), make([]string, len(fields))
	for i, field := range fields {
		firsts[i], lasts[i], classes[i] = field.FirstName, field.LastName, field.SchoolClass
	}
	return firsts, lasts, classes
}

// keepClassTimeSQL gives a child a class-list entry joins the class time the
// entry stood for (#4803): from the Berlin day the entry was created, when
// the child's care starts later. A child without an OGS place and a child in
// care already need none. A class time kept from another class gives way.
const keepClassTimeSQL = `UPDATE users.student_school_memberships AS m
SET class_member_from = joined.since, class_member_class = joined.school_class
FROM (
	SELECT pair.student_id, MIN((entry.created_at AT TIME ZONE 'Europe/Berlin')::date) AS since,
		MIN(entry.school_class) AS school_class
	FROM unnest(?::bigint[], ?::bigint[]) AS pair(entry_id, student_id)
	JOIN users.class_list_entries AS entry ON entry.tenant_id = ? AND entry.id = pair.entry_id
	GROUP BY pair.student_id
) AS joined
WHERE m.tenant_id = ? AND m.student_profile_id = joined.student_id AND m.deleted_at IS NULL
	AND NOT m.without_care_place
	AND COALESCE(m.first_care_from, m.enrolled_from) > joined.since
	AND (m.class_member_from IS NULL OR m.class_member_from > joined.since
		OR LOWER(TRIM(m.class_member_class)) IS DISTINCT FROM LOWER(TRIM(m.school_class)))`

// KeepClassTimeOfJoinedChildren records, in one statement, the class time
// of the children class-list entries join before the entries go (#4803).
func (s *Store) KeepClassTimeOfJoinedChildren(ctx context.Context, joins []schoolmembership.ClassListEntryJoin) (domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return domain.OperationStats{}, err
	}
	entries := make([]int64, len(joins))
	students := make([]int64, len(joins))
	for i, join := range joins {
		entries[i], students[i] = join.EntryID, join.StudentID
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	result, err := db.NewRaw(keepClassTimeSQL, pgdialect.Array(entries), pgdialect.Array(students), scope.TenantID, scope.TenantID).Exec(ctx)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return stats, fmt.Errorf("school membership postgres: keep class time of joined children: %w", err)
	}
	stats.Rows, _ = result.RowsAffected()
	return stats, nil
}

// DeleteClassListEntries deletes the tenant's entries with the given IDs in
// one statement (#4803).
func (s *Store) DeleteClassListEntries(ctx context.Context, ids []int64) (int64, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return 0, domain.OperationStats{}, err
	}
	query := withTenant(db.NewDelete().Model((*classListEntryRow)(nil)).
		ModelTableExpr(`users.class_list_entries AS "class_list_entry"`).
		Where(`"class_list_entry".id = ANY(?)`, pgdialect.Array(ids)), "class_list_entry", scope)
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	result, err := query.Exec(ctx)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return 0, stats, fmt.Errorf("school membership postgres: delete class list entries: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return 0, stats, fmt.Errorf("school membership postgres: delete class list entries: count rows: %w", err)
	}
	stats.Rows = rows
	return rows, stats, nil
}
