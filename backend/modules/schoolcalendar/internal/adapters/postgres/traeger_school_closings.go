package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// schoolClosingsSQL reads the closing days of a school set on one day: the
// schools' own and those the Träger ?1 planned for them. The school set is
// the Träger's current schools, so a Träger closing day counts only while
// the school belongs to that Träger (ADR 0194). The administrative
// transaction has no row security; both filters are the boundary.
const schoolClosingsSQL = `SELECT tenant_id AS school_id, start_date, end_date, reason, false AS traeger
	FROM schedule.closing_days
	WHERE tenant_id = ANY(?0) AND start_date <= ?2 AND end_date >= ?2
	UNION ALL
	SELECT school.id, traeger_day.start_date, traeger_day.end_date, traeger_day.reason, true
	FROM schedule.traeger_closing_days AS traeger_day
	CROSS JOIN LATERAL unnest(traeger_day.school_ids) AS school(id)
	WHERE traeger_day.organization_id = ?1 AND traeger_day.school_ids && ?0 AND school.id = ANY(?0)
		AND traeger_day.start_date <= ?2 AND traeger_day.end_date >= ?2
	ORDER BY school_id, traeger, start_date, reason`

type schoolClosingRow struct {
	SchoolID  int64         `bun:"school_id"`
	StartDate calendar.Date `bun:"start_date,type:date"`
	EndDate   calendar.Date `bun:"end_date,type:date"`
	Reason    string        `bun:"reason"`
	Traeger   bool          `bun:"traeger"`
}

// ListSchoolClosings reads the closing days of the schools on day (#7672),
// only in the administrative transaction of the Träger projection.
func (s *TraegerClosingDayStore) ListSchoolClosings(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) ([]domain.SchoolClosing, error) {
	if organizationID <= 0 || !tenant.IsAdminTx(ctx) {
		return nil, errors.New("school calendar postgres: the closings of a Träger's schools need the administrative transaction")
	}
	raw, ok := tenant.TransactionFromContext(ctx)
	if !ok {
		return nil, errors.New("school calendar postgres: transaction is required")
	}
	tx, ok := raw.(bun.Tx)
	if !ok {
		return nil, fmt.Errorf("school calendar postgres: unsupported transaction %T", raw)
	}
	var rows []schoolClosingRow
	if err := tx.NewRaw(schoolClosingsSQL, pgdialect.Array(schools), organizationID, day).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("school calendar postgres: closings of a Träger's schools: %w", err)
	}
	result := make([]domain.SchoolClosing, 0, len(rows))
	for _, row := range rows {
		result = append(result, domain.SchoolClosing(row))
	}
	return result, nil
}
