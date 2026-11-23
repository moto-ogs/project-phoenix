package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// ListStaffAbsencesAndGroupSubstitutions reads the absences and the group
// substitutions of two filters in one statement (#7903): each list is
// aggregated as JSON, ordered by ID. The filters are those of
// ListStaffAbsences and ListGroupSubstitutions; order, limit and offset are
// not applied.
func (s *Store) ListStaffAbsencesAndGroupSubstitutions(ctx context.Context, absences domain.StaffAbsenceFilter, substitutions domain.GroupSubstitutionFilter) ([]domain.StaffAbsence, []domain.GroupSubstitution, domain.OperationStats, error) {
	db, scope, err := s.database(ctx)
	if err != nil {
		return nil, nil, domain.OperationStats{}, err
	}
	absenceQuery := applyStaffAbsenceFilter(withTenant(db.NewSelect().
		Model((*staffAbsenceRow)(nil)).
		ModelTableExpr(tableStaffAbsences+` AS "staff_absence"`), aliasStaffAbsence, scope), absences)
	substitutionQuery, empty := applyGroupSubstitutionFilter(withTenant(db.NewSelect().
		Model((*groupSubstitutionRow)(nil)).
		ModelTableExpr(tableGroupSubstitution+` AS "group_substitution"`), aliasGroupSubstitution, scope), substitutions)
	if empty {
		substitutionQuery = substitutionQuery.Where("FALSE")
	}
	var absenceJSON, substitutionJSON string
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	err = db.NewSelect().
		ColumnExpr(`COALESCE((SELECT json_agg(absence ORDER BY absence.id) FROM (?) AS absence), '[]'::json)`, absenceQuery).
		ColumnExpr(`COALESCE((SELECT json_agg(substitution ORDER BY substitution.id) FROM (?) AS substitution), '[]'::json)`, substitutionQuery).
		Scan(ctx, &absenceJSON, &substitutionJSON)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, nil, stats, fmt.Errorf("workforce postgres: list staff absences and group substitutions: %w", err)
	}
	absenceRows, substitutionRows := []staffAbsenceRow{}, []groupSubstitutionRow{}
	if err := json.Unmarshal([]byte(absenceJSON), &absenceRows); err != nil {
		return nil, nil, stats, fmt.Errorf("workforce postgres: decode staff absences: %w", err)
	}
	if err := json.Unmarshal([]byte(substitutionJSON), &substitutionRows); err != nil {
		return nil, nil, stats, fmt.Errorf("workforce postgres: decode group substitutions: %w", err)
	}
	stats.Rows = int64(len(absenceRows) + len(substitutionRows))
	result := make([]domain.GroupSubstitution, 0, len(substitutionRows))
	for _, row := range substitutionRows {
		result = append(result, groupSubstitutionToDomain(row))
	}
	return staffAbsencesToDomain(absenceRows), result, stats, nil
}
