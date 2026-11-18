package test

import (
	"context"
	"database/sql"
	"maps"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// SnapshotQueries names scalar SELECTs that together describe a test fixture's
// state. Read executes them as one statement, including on a caller's active
// transaction. A NULL snapshot omits its key.
type SnapshotQueries map[string]string

func (queries SnapshotQueries) statement() (string, []string) {
	names := slices.Sorted(maps.Keys(queries))
	selects := make([]string, 0, len(names))
	for i, name := range names {
		selects = append(selects, "SELECT "+strconv.Itoa(i)+" AS snapshot_index, ("+queries[name]+")::text AS payload")
	}
	return strings.Join(selects, "\nUNION ALL\n"), names
}

type snapshotRow struct {
	Index   int            `bun:"snapshot_index"`
	Payload sql.NullString `bun:"payload"`
}

func collectSnapshots(names []string, rows []snapshotRow) map[string]string {
	result := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.Payload.Valid {
			result[names[row.Index]] = row.Payload.String
		}
	}
	return result
}

// Read uses Bun placeholders such as ?0 when several SELECTs share an argument.
func (queries SnapshotQueries) Read(ctx context.Context, db bun.IDB, args ...any) (map[string]string, error) {
	statement, names := queries.statement()
	if len(names) == 0 {
		return map[string]string{}, nil
	}
	var rows []snapshotRow
	if err := db.NewRaw(statement, args...).Scan(ctx, &rows); err != nil {
		return nil, err
	}
	return collectSnapshots(names, rows), nil
}

// ReadCounts collects named COUNT queries on the caller's connection or transaction.
func (queries SnapshotQueries) ReadCounts(t testing.TB, ctx context.Context, db bun.IDB, args ...any) map[string]int {
	t.Helper()
	rows, err := queries.Read(ctx, db, args...)
	require.NoError(t, err)
	require.Len(t, rows, len(queries), "every count query returns a value")
	counts := make(map[string]int, len(rows))
	for name, value := range rows {
		count, err := strconv.Atoi(value)
		require.NoError(t, err, name)
		counts[name] = count
	}
	return counts
}

// SnapshotReader reads a prepared fixture snapshot with the supplied PostgreSQL
// bind parameters.
type SnapshotReader func(context.Context, ...any) (map[string]string, error)

// Prepare reuses one statement across repeated reads. The SELECTs use native
// PostgreSQL bind parameters such as $1.
func (queries SnapshotQueries) Prepare(t testing.TB, db *bun.DB) SnapshotReader {
	t.Helper()
	statement, names := queries.statement()
	require.NotEmpty(t, names, "no queries in fixture snapshot")
	stmt, err := db.DB.PrepareContext(t.Context(), statement)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, stmt.Close()) })
	return func(ctx context.Context, args ...any) (map[string]string, error) {
		rows, err := stmt.QueryContext(ctx, args...)
		if err != nil {
			return nil, err
		}
		defer func() { _ = rows.Close() }()
		snapshots := make([]snapshotRow, 0, len(names))
		for rows.Next() {
			var row snapshotRow
			if err := rows.Scan(&row.Index, &row.Payload); err != nil {
				return nil, err
			}
			snapshots = append(snapshots, row)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return collectSnapshots(names, snapshots), nil
	}
}

// TableSnapshotQuery returns all matching rows in a canonical order. The
// fixture supplies a SQL predicate over the table alias r.
func TableSnapshotQuery(db bun.IDB, table, predicate string) string {
	return db.NewSelect().
		ColumnExpr(`COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text), '[]'::jsonb)`).
		TableExpr("? AS r", bun.Ident(table)).
		Where(predicate).
		String()
}
