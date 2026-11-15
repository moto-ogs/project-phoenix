package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The writes and the log of the Personal-Import (#4724), all in the Träger
// transaction and each in one statement, whatever the number of rows.

// ReserveStaffRecordIDs draws count IDs from the record sequence.
func (s *TraegerStaffStore) ReserveStaffRecordIDs(ctx context.Context, organizationID int64, count int) ([]int64, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil || count <= 0 {
		return nil, err
	}
	ids := make([]int64, 0, count)
	if err := db.NewRaw(`SELECT nextval('workforce.staff_records_id_seq') FROM generate_series(1, ?)`, count).Scan(ctx, &ids); err != nil {
		return nil, fmt.Errorf("workforce postgres: reserve staff record ids: %w", err)
	}
	return ids, nil
}

// InsertStaffRecords inserts records with their reserved IDs.
func (s *TraegerStaffStore) InsertStaffRecords(ctx context.Context, organizationID int64, records []domain.TraegerStaffRecord) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil || len(records) == 0 {
		return err
	}
	rows := make([]staffRecordRow, len(records))
	for i, record := range records {
		row := staffRecordRow{
			ID: record.ID, OrganizationID: organizationID, FirstName: record.FirstName, LastName: record.LastName,
			PersonnelNumber: record.PersonnelNumber, IBANSealed: record.IBANSealed, IBANMasked: record.IBANMasked,
			TaxIDSealed: record.TaxIDSealed, SocialSecurityNumberSealed: record.SocialSecurityNumberSealed,
		}
		if record.Birthday != "" {
			day, err := calendar.ParseDate(record.Birthday)
			if err != nil {
				return fmt.Errorf("workforce postgres: staff record birthday: %w", err)
			}
			row.Birthday = &day
		}
		rows[i] = row
	}
	_, err = db.NewInsert().Model(&rows).Exec(ctx)
	if isUniqueViolationOn(err, staffRecordPersonnelNumberIndex) {
		return domain.ErrStaffPersonnelNumberTaken
	}
	if err != nil {
		return fmt.Errorf("workforce postgres: insert imported staff records: %w", err)
	}
	return nil
}

// FillStaffRecordFinancial fills each record's empty bank and tax columns
// with the sealed values given; a column with a value keeps it, so a change
// the office saved meanwhile is never overwritten. An empty value (a field
// the row does not fill) binds as an empty bytea and counts as none.
func (s *TraegerStaffStore) FillStaffRecordFinancial(ctx context.Context, organizationID int64, records []domain.TraegerStaffRecord) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil || len(records) == 0 {
		return err
	}
	ids := make([]int64, len(records))
	ibans, masks, taxIDs, socials := make([][]byte, len(records)), make([]*string, len(records)), make([][]byte, len(records)), make([][]byte, len(records))
	for i, record := range records {
		ids[i], ibans[i], masks[i], taxIDs[i], socials[i] = record.ID, record.IBANSealed, record.IBANMasked, record.TaxIDSealed, record.SocialSecurityNumberSealed
	}
	if _, err := db.ExecContext(ctx, `UPDATE workforce.staff_records AS record SET
			iban_masked = CASE WHEN record.iban_sealed IS NULL AND NULLIF(fill.iban_sealed, ''::bytea) IS NOT NULL
				THEN fill.iban_masked ELSE record.iban_masked END,
			iban_sealed = COALESCE(record.iban_sealed, NULLIF(fill.iban_sealed, ''::bytea)),
			tax_id_sealed = COALESCE(record.tax_id_sealed, NULLIF(fill.tax_id_sealed, ''::bytea)),
			social_security_number_sealed = COALESCE(record.social_security_number_sealed, NULLIF(fill.social_security_number_sealed, ''::bytea))
		FROM unnest(?::bigint[], ?::bytea[], ?::varchar[], ?::bytea[], ?::bytea[])
			AS fill (id, iban_sealed, iban_masked, tax_id_sealed, social_security_number_sealed)
		WHERE record.organization_id = ? AND record.id = fill.id`,
		pgdialect.Array(ids), pgdialect.Array(ibans), pgdialect.Array(masks), pgdialect.Array(taxIDs), pgdialect.Array(socials),
		organizationID); err != nil {
		return fmt.Errorf("workforce postgres: fill imported staff financial data: %w", err)
	}
	return nil
}

// StaffImportEvents groups the import entries of the trail: one import is
// one account, one transaction and one file. The text of an entry is
// "Zeile <n>: <file>".
func (s *TraegerStaffStore) StaffImportEvents(ctx context.Context, organizationID int64, limit int) ([]domain.StaffImportEvent, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		bun.BaseModel `bun:"-"`
		File          string    `bun:"file"`
		AccountID     int64     `bun:"account_id"`
		ImportedAt    time.Time `bun:"occurred_at"`
		Created       int       `bun:"created"`
		Completed     int       `bun:"completed"`
	}
	if err := db.NewRaw(`SELECT regexp_replace(value_text, '^Zeile [0-9]+: ', '') AS file, account_id, occurred_at,
			count(*) FILTER (WHERE field = ?) AS created,
			count(DISTINCT staff_record_id) FILTER (WHERE field <> ?) AS completed
		FROM workforce.staff_record_changes
		WHERE organization_id = ? AND kind = ?
		GROUP BY 1, account_id, occurred_at
		ORDER BY occurred_at DESC, 1
		LIMIT ?`,
		domain.StaffChangeFieldRecord, domain.StaffChangeFieldRecord, organizationID, domain.StaffChangeImported, limit).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read staff imports: %w", err)
	}
	events := make([]domain.StaffImportEvent, len(rows))
	for i, row := range rows {
		events[i] = domain.StaffImportEvent{File: row.File, AccountID: row.AccountID, ImportedAt: row.ImportedAt, Created: row.Created, Completed: row.Completed}
	}
	return events, nil
}
