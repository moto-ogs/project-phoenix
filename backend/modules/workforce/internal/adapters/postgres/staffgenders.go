package postgres

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// StaffGenders reads the stated gender of each listed staff member from
// users.staff_master_data in one statement.
func (s *Store) StaffGenders(ctx context.Context, staffIDs []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(staffIDs))
	if len(staffIDs) == 0 {
		return result, nil
	}
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, err
	}
	var rows []staffMasterDataRow
	query := withTenant(db.NewSelect().Model(&rows).
		ModelTableExpr(tableStaffMasterData+` AS "staff_master_data"`).
		Column("staff_id", "gender").
		Where(`"staff_master_data".staff_id IN (?)`, bun.List(staffIDs)).
		Where(`"staff_master_data".gender IS NOT NULL`), aliasStaffMasterData, scope)
	if err := query.Scan(ctx); err != nil {
		return nil, fmt.Errorf("workforce postgres: list staff genders: %w", err)
	}
	for _, row := range rows {
		if row.Gender != nil {
			result[row.StaffID] = *row.Gender
		}
	}
	return result, nil
}
