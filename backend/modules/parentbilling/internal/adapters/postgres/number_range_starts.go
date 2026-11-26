package postgres

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The start values of the number ranges (#7358, ADR 0119 addendum
// 2026-11-17). The counter row holds the start value the release reads
// (ReserveNumbers); number_range_starts is its history and only grows.

type numberRangeStartRow struct {
	bun.BaseModel `bun:"table:parent_billing.number_range_starts"`

	ID             int64     `bun:"id,pk,autoincrement"`
	OrganizationID int64     `bun:"organization_id"`
	IssuerKey      string    `bun:"issuer_key"`
	Service        string    `bun:"service"`
	Year           int       `bun:"year"`
	NextNumber     int64     `bun:"next_number"`
	ActorAccountID *int64    `bun:"actor_account_id"`
	OccurredAt     time.Time `bun:"occurred_at"`
}

// invoiceNumberServices are the services whose counters number invoices;
// the counter of the export files (service export) is not one of them.
var invoiceNumberServices = []string{parentbilling.ServiceHoliday, parentbilling.ServiceCare}

// NumberCounters names per issuer, service and year the last issued
// invoice number of the Träger and the number its next invoice gets.
func (s *Store) NumberCounters(ctx context.Context, organizationID int64) (map[parentbilling.NumberCounterKey]parentbilling.NumberCounter, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		IssuerKey  string `bun:"issuer_key"`
		Service    string `bun:"service"`
		Year       int    `bun:"year"`
		LastNumber int64  `bun:"last_number"`
		NextNumber int64  `bun:"next_number"`
	}
	if err := db.NewRaw(`SELECT issuer_key, service, year, last_number, GREATEST(last_number, COALESCE(start_number, 1) - 1) + 1 AS next_number
		FROM parent_billing.number_range_counters
		WHERE organization_id = ? AND service IN (?)`, organizationID, bun.List(invoiceNumberServices)).Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counters := make(map[parentbilling.NumberCounterKey]parentbilling.NumberCounter, len(rows))
	for _, row := range rows {
		key := parentbilling.NumberCounterKey{IssuerKey: row.IssuerKey, Service: row.Service, Year: row.Year}
		counters[key] = parentbilling.NumberCounter{LastNumber: row.LastNumber, NextNumber: row.NextNumber}
	}
	return counters, nil
}

// NumberRangeStarts lists every start value of the Träger, the newest
// first.
func (s *Store) NumberRangeStarts(ctx context.Context, organizationID int64) ([]parentbilling.NumberRangeStart, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []numberRangeStartRow
	if err := db.NewSelect().Model(&rows).Where("organization_id = ?", organizationID).OrderExpr("id DESC").Scan(ctx); err != nil {
		return nil, err
	}
	starts := make([]parentbilling.NumberRangeStart, len(rows))
	for i, row := range rows {
		starts[i] = parentbilling.NumberRangeStart{IssuerKey: row.IssuerKey, Service: row.Service, Year: row.Year, NextNumber: row.NextNumber,
			SetAt: row.OccurredAt, AccountID: row.ActorAccountID}
	}
	return starts, nil
}

// SetNumberRangeStart sets the start value of the counter and adds it to
// the history, on the store clock (ADR 0281). One statement checks and
// writes on the counter row it holds, so a release and a start value never
// pass each other: a value at or below the last issued number writes nothing
// and answers that number with false.
func (s *Store) SetNumberRangeStart(ctx context.Context, organizationID int64, start parentbilling.NumberRangeStart) (int64, bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, false, err
	}
	now := s.now()
	var last int64
	err = db.NewRaw(`INSERT INTO parent_billing.number_range_counters AS counter (organization_id, issuer_key, service, year, last_number, start_number, updated_at)
		VALUES (?, ?, ?, ?, 0, ?, ?)
		ON CONFLICT (organization_id, issuer_key, service, year)
		DO UPDATE SET start_number = EXCLUDED.start_number, updated_at = EXCLUDED.updated_at
			WHERE counter.last_number < EXCLUDED.start_number
		RETURNING last_number`, organizationID, start.IssuerKey, start.Service, start.Year, start.NextNumber, now).Scan(ctx, &last)
	if errors.Is(err, sql.ErrNoRows) {
		// The refused statement held no row; the number it names is the
		// one issued by now.
		err = db.NewRaw(`SELECT last_number FROM parent_billing.number_range_counters
			WHERE organization_id = ? AND issuer_key = ? AND service = ? AND year = ?`, organizationID, start.IssuerKey, start.Service, start.Year).Scan(ctx, &last)
		return last, false, err
	}
	if err != nil {
		return 0, false, err
	}
	row := &numberRangeStartRow{OrganizationID: organizationID, IssuerKey: start.IssuerKey, Service: start.Service, Year: start.Year,
		NextNumber: start.NextNumber, ActorAccountID: start.AccountID, OccurredAt: now}
	_, err = db.NewInsert().Model(row).Exec(ctx)
	return last, true, err
}
