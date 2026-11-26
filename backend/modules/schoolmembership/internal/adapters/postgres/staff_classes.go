package postgres

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/schoolmembership/internal/domain"
)

// staffClassesRow is a live staff record with its assigned school classes.
type staffClassesRow struct {
	ID      int64    `bun:"id"`
	Classes []string `bun:"school_classes,array"`
}

// FindStaffClassesByPerson reads the live staff record of a person and the
// school classes assigned to it in one statement (#8155), in the order of
// ListClassAssignments.
func (s *Store) FindStaffClassesByPerson(ctx context.Context, personID int64) (int64, []string, bool, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return 0, nil, false, domain.OperationStats{}, err
	}
	row := &staffClassesRow{}
	query := withTenant(db.NewSelect().Model(row).ModelTableExpr(`users.staff_school_memberships AS "staff"`).
		ColumnExpr(`"staff".id`).
		ColumnExpr(`ARRAY(SELECT "class_assignment".school_class FROM education.class_teachers AS "class_assignment"
			WHERE "class_assignment".tenant_id = "staff".tenant_id AND "class_assignment".staff_id = "staff".id
			ORDER BY LOWER(BTRIM("class_assignment".school_class)) ASC, "class_assignment".id ASC) AS school_classes`).
		Where(`"staff".person_id = ?`, personID).
		Where(`"staff".deleted_at IS NULL`).
		OrderExpr(`"staff".id ASC`).
		Limit(1), "staff", scope)
	found, stats, err := scanOne(ctx, query, "find staff classes by person")
	if err != nil || !found {
		return 0, nil, found, stats, err
	}
	return row.ID, row.Classes, true, stats, nil
}
