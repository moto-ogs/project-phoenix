package postgres

import (
	"context"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The number ranges of a Träger per issuer and service (#4668, ADR 0119,
// #8040 ADR 0321) and the counters a release reserves its numbers from.

type numberRangeRow struct {
	bun.BaseModel `bun:"table:parent_billing.number_ranges"`

	ID             int64     `bun:"id,pk,autoincrement"`
	OrganizationID int64     `bun:"organization_id"`
	IssuerKey      string    `bun:"issuer_key"`
	Service        string    `bun:"service"`
	Pattern        string    `bun:"pattern"`
	UpdatedAt      time.Time `bun:"updated_at,nullzero"`
}

func (r numberRangeRow) numberRange() parentbilling.NumberRange {
	updatedAt := r.UpdatedAt
	return parentbilling.NumberRange{Issuer: parentbilling.BillingIssuer{Key: r.IssuerKey}, Service: r.Service, Pattern: r.Pattern,
		UpdatedAt: &updatedAt}
}

// ListNumberRanges lists the number ranges of the Träger by issuer and
// service (#8040).
func (s *Store) ListNumberRanges(ctx context.Context, organizationID int64) ([]parentbilling.NumberRange, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []numberRangeRow
	if err := db.NewSelect().Model(&rows).Where("organization_id = ?", organizationID).OrderExpr("issuer_key, service").Scan(ctx); err != nil {
		return nil, err
	}
	ranges := make([]parentbilling.NumberRange, len(rows))
	for i, row := range rows {
		ranges[i] = row.numberRange()
	}
	return ranges, nil
}

// SetNumberRange stores or replaces the pattern of a service of an issuer.
func (s *Store) SetNumberRange(ctx context.Context, organizationID int64, issuerKey, service, pattern string) (parentbilling.NumberRange, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return parentbilling.NumberRange{}, err
	}
	row := &numberRangeRow{OrganizationID: organizationID, IssuerKey: issuerKey, Service: service, Pattern: pattern}
	if _, err := db.NewInsert().Model(row).
		On("CONFLICT (organization_id, issuer_key, service) DO UPDATE").Set("pattern = EXCLUDED.pattern").
		Returning("id, updated_at").Exec(ctx); err != nil {
		return parentbilling.NumberRange{}, err
	}
	return row.numberRange(), nil
}

// ReserveNumbers raises the counter by count in one statement, from the
// last issued number or from the start value of the counter when that is
// larger (#7358). Both stand on the counter row, which the statement holds
// until the transaction ends: a release that waits for a start value sees
// it, and a rollback returns the numbers, so the numbers of committed
// invoices have no gap. Each issuer counts on its own (#8040).
func (s *Store) ReserveNumbers(ctx context.Context, organizationID int64, issuerKey, service string, year, count int) (int64, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, err
	}
	var last int64
	if err := db.NewRaw(`INSERT INTO parent_billing.number_range_counters AS counter (organization_id, issuer_key, service, year, last_number, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (organization_id, issuer_key, service, year)
		DO UPDATE SET last_number = GREATEST(counter.last_number, COALESCE(counter.start_number, 1) - 1) + EXCLUDED.last_number,
			updated_at = EXCLUDED.updated_at
		RETURNING last_number`, organizationID, issuerKey, service, year, count, s.now()).Scan(ctx, &last); err != nil {
		return 0, err
	}
	return last - int64(count) + 1, nil
}
