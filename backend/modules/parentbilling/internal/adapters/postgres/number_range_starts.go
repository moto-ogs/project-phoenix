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
// 2026-11-17). Rows are only added; the newest of a counter is its floor
// (ReserveNumbers), the older ones its history.

type numberRangeStartRow struct {
	bun.BaseModel `bun:"table:parent_billing.number_range_starts"`

	ID             int64     `bun:"id,pk,autoincrement"`
	OrganizationID int64     `bun:"organization_id"`
	Service        string    `bun:"service"`
	Year           int       `bun:"year"`
	NextNumber     int64     `bun:"next_number"`
	ActorAccountID *int64    `bun:"actor_account_id"`
	OccurredAt     time.Time `bun:"occurred_at"`
}

// invoiceNumberServices are the services whose counters number invoices;
// the counter of the export files (service export) is not one of them.
var invoiceNumberServices = []string{parentbilling.ServiceHoliday, parentbilling.ServiceCare}

// NumberCounters names the last issued invoice number of the Träger per
// service and year.
func (s *Store) NumberCounters(ctx context.Context, organizationID int64) (map[string]map[int]int64, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Service    string `bun:"service"`
		Year       int    `bun:"year"`
		LastNumber int64  `bun:"last_number"`
	}
	if err := db.NewRaw(`SELECT service, year, last_number FROM parent_billing.number_range_counters
		WHERE organization_id = ? AND service IN (?)`, organizationID, bun.List(invoiceNumberServices)).Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counters := make(map[string]map[int]int64, len(invoiceNumberServices))
	for _, row := range rows {
		if counters[row.Service] == nil {
			counters[row.Service] = map[int]int64{}
		}
		counters[row.Service][row.Year] = row.LastNumber
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
		starts[i] = parentbilling.NumberRangeStart{Service: row.Service, Year: row.Year, NextNumber: row.NextNumber,
			SetAt: row.OccurredAt, AccountID: row.ActorAccountID}
	}
	return starts, nil
}

// LockNumberCounter holds the counter of the service and year until the
// transaction ends and names its last issued number, 0 before the first.
func (s *Store) LockNumberCounter(ctx context.Context, organizationID int64, service string, year int) (int64, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return 0, err
	}
	var last int64
	err = db.NewRaw(`SELECT last_number FROM parent_billing.number_range_counters
		WHERE organization_id = ? AND service = ? AND year = ? FOR UPDATE`, organizationID, service, year).Scan(ctx, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return last, err
}

// InsertNumberRangeStart adds a start value on the store clock (ADR 0281).
func (s *Store) InsertNumberRangeStart(ctx context.Context, organizationID int64, start parentbilling.NumberRangeStart) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	row := &numberRangeStartRow{OrganizationID: organizationID, Service: start.Service, Year: start.Year,
		NextNumber: start.NextNumber, ActorAccountID: start.AccountID, OccurredAt: s.now()}
	_, err = db.NewInsert().Model(row).Exec(ctx)
	return err
}
