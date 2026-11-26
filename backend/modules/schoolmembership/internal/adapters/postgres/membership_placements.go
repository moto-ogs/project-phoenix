package postgres

import (
	"context"
	"fmt"

	"github.com/uptrace/bun/dialect/pgdialect"
)

// membershipPlacementsSQL takes the school set, then the memberships.
const membershipPlacementsSQL = `SELECT id, school_class, group_id
FROM users.student_school_memberships
WHERE tenant_id = ANY(?) AND id = ANY(?) AND deleted_at IS NULL`

// MembershipPlacementsByTenant maps each of the given live memberships to
// its school class and to its group, where it has one.
func (r schoolRosters) MembershipPlacementsByTenant(ctx context.Context, schools, memberships []int64) (map[int64]string, map[int64]int64, error) {
	classes, groups := make(map[int64]string, len(memberships)), make(map[int64]int64, len(memberships))
	if len(schools) == 0 || len(memberships) == 0 {
		return classes, groups, nil
	}
	db, err := r.database(ctx)
	if err != nil {
		return nil, nil, err
	}
	var rows []struct {
		ID          int64  `bun:"id"`
		SchoolClass string `bun:"school_class"`
		GroupID     *int64 `bun:"group_id"`
	}
	if err := db.NewRaw(membershipPlacementsSQL, pgdialect.Array(schools), pgdialect.Array(memberships)).Scan(ctx, &rows); err != nil {
		return nil, nil, fmt.Errorf("school membership postgres: membership placements: %w", err)
	}
	for _, row := range rows {
		if row.SchoolClass != "" {
			classes[row.ID] = row.SchoolClass
		}
		if row.GroupID != nil {
			groups[row.ID] = *row.GroupID
		}
	}
	return classes, groups, nil
}
