package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// schoolDaysSQL reads the closing days and the opening changes of a school
// set on one day, in one statement: the schools' own closing days, those the
// Träger ?1 planned for them (#7672), and the schools' and Träger's opening
// changes (#8146, #8202). The school set is the Träger's current schools, so
// a Träger day counts only while the school belongs to that Träger (ADR
// 0194). An opening change carries its hours, never its reason. The
// administrative transaction has no row security; both filters are the
// boundary.
const schoolDaysSQL = `SELECT tenant_id AS school_id, start_date, end_date, reason, false AS traeger,
		NULL::text AS opens_at, NULL::text AS closes_at
	FROM schedule.closing_days
	WHERE tenant_id = ANY(?0) AND start_date <= ?2 AND end_date >= ?2
	UNION ALL
	SELECT school.id, traeger_day.start_date, traeger_day.end_date, traeger_day.reason, true, NULL, NULL
	FROM schedule.traeger_closing_days AS traeger_day
	CROSS JOIN LATERAL unnest(traeger_day.school_ids) AS school(id)
	WHERE traeger_day.organization_id = ?1 AND traeger_day.school_ids && ?0 AND school.id = ANY(?0)
		AND traeger_day.start_date <= ?2 AND traeger_day.end_date >= ?2
	UNION ALL
	SELECT tenant_id, start_date, end_date, '', false, opens_at::text, closes_at::text
	FROM schedule.opening_changes
	WHERE tenant_id = ANY(?0) AND start_date <= ?2 AND end_date >= ?2
	UNION ALL
	SELECT school.id, traeger_change.start_date, traeger_change.end_date, '', true, traeger_change.opens_at::text, traeger_change.closes_at::text
	FROM schedule.traeger_opening_changes AS traeger_change
	CROSS JOIN LATERAL unnest(traeger_change.school_ids) AS school(id)
	WHERE traeger_change.organization_id = ?1 AND traeger_change.school_ids && ?0 AND school.id = ANY(?0)
		AND traeger_change.start_date <= ?2 AND traeger_change.end_date >= ?2
	ORDER BY school_id, opens_at NULLS FIRST, closes_at, traeger, start_date, reason`

type schoolDayRow struct {
	SchoolID  int64          `bun:"school_id"`
	StartDate calendar.Date  `bun:"start_date,type:date"`
	EndDate   calendar.Date  `bun:"end_date,type:date"`
	Reason    string         `bun:"reason"`
	Traeger   bool           `bun:"traeger"`
	OpensAt   sql.NullString `bun:"opens_at"`
	ClosesAt  sql.NullString `bun:"closes_at"`
}

// ListSchoolDays reads the closing days and the opening changes of the
// schools on day (#7672, #8146, #8202), only in the administrative
// transaction of the Träger projection.
func (s *TraegerClosingDayStore) ListSchoolDays(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) ([]domain.SchoolClosing, []domain.SchoolOpening, error) {
	if organizationID <= 0 || !tenant.IsAdminTx(ctx) {
		return nil, nil, errors.New("school calendar postgres: the days of a Träger's schools need the administrative transaction")
	}
	raw, ok := tenant.TransactionFromContext(ctx)
	if !ok {
		return nil, nil, errors.New("school calendar postgres: transaction is required")
	}
	tx, ok := raw.(bun.Tx)
	if !ok {
		return nil, nil, fmt.Errorf("school calendar postgres: unsupported transaction %T", raw)
	}
	var rows []schoolDayRow
	if err := tx.NewRaw(schoolDaysSQL, pgdialect.Array(schools), organizationID, day).Scan(ctx, &rows); err != nil {
		return nil, nil, fmt.Errorf("school calendar postgres: days of a Träger's schools: %w", err)
	}
	closings := make([]domain.SchoolClosing, 0, len(rows))
	openings := []domain.SchoolOpening{}
	for _, row := range rows {
		if row.OpensAt.Valid && row.ClosesAt.Valid {
			openings = append(openings, domain.SchoolOpening{
				SchoolID: row.SchoolID, StartDate: row.StartDate, EndDate: row.EndDate,
				OpensAt: wallClock(row.OpensAt.String), ClosesAt: wallClock(row.ClosesAt.String),
			})
			continue
		}
		closings = append(closings, domain.SchoolClosing{
			SchoolID: row.SchoolID, StartDate: row.StartDate, EndDate: row.EndDate, Reason: row.Reason, Traeger: row.Traeger,
		})
	}
	return closings, openings, nil
}
