package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
)

// The payroll values of the bodies that employ staff in place of the Träger
// and the personnel numbers per employer (#8041, ADR 0319), in the Träger
// transaction of their Träger.

type payrollEmployerRow struct {
	OrganizationID   int64     `bun:"organization_id"`
	SchoolID         int64     `bun:"school_id"`
	Body             string    `bun:"body"`
	ConsultantNumber string    `bun:"consultant_number"`
	ClientNumber     string    `bun:"client_number"`
	CostCenter       string    `bun:"cost_center"`
	UpdatedAt        time.Time `bun:"updated_at"`
}

func (r payrollEmployerRow) toDomain() domain.TraegerPayrollEmployer {
	return domain.TraegerPayrollEmployer{
		OrganizationID: r.OrganizationID, SchoolID: r.SchoolID, Body: r.Body,
		ConsultantNumber: r.ConsultantNumber, ClientNumber: r.ClientNumber, CostCenter: r.CostCenter, UpdatedAt: r.UpdatedAt,
	}
}

const payrollEmployerColumns = `organization_id, school_id, body, consultant_number, client_number, cost_center, updated_at`

// ListPayrollEmployers returns every stored value of the Träger.
func (s *TraegerStaffStore) ListPayrollEmployers(ctx context.Context, organizationID int64) ([]domain.TraegerPayrollEmployer, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []payrollEmployerRow
	if err := db.NewRaw(`SELECT `+payrollEmployerColumns+` FROM workforce.payroll_employers
		WHERE organization_id = ? ORDER BY school_id, body`, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read payroll employers: %w", err)
	}
	values := make([]domain.TraegerPayrollEmployer, len(rows))
	for i, row := range rows {
		values[i] = row.toDomain()
	}
	return values, nil
}

// LockPayrollEmployer locks the values of the body at the school.
func (s *TraegerStaffStore) LockPayrollEmployer(ctx context.Context, organizationID, schoolID int64, body string) (*domain.TraegerPayrollEmployer, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var row payrollEmployerRow
	err = db.NewRaw(`SELECT `+payrollEmployerColumns+` FROM workforce.payroll_employers
		WHERE organization_id = ? AND school_id = ? AND body = ? FOR UPDATE`, organizationID, schoolID, body).Scan(ctx, &row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("workforce postgres: lock payroll employer: %w", err)
	}
	value := row.toDomain()
	return &value, nil
}

// SavePayrollEmployer updates or inserts the values of the body at the
// school and returns them as stored.
func (s *TraegerStaffStore) SavePayrollEmployer(ctx context.Context, value domain.TraegerPayrollEmployer, accountID int64, insert bool,
) (domain.TraegerPayrollEmployer, bool, error) {
	db, err := traegerStaffDB(ctx, value.OrganizationID)
	if err != nil {
		return domain.TraegerPayrollEmployer{}, false, err
	}
	var rows []payrollEmployerRow
	if insert {
		err = db.NewRaw(`INSERT INTO workforce.payroll_employers (organization_id, school_id, body, consultant_number, client_number, cost_center, updated_by)
			VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (organization_id, school_id, body) DO NOTHING
			RETURNING `+payrollEmployerColumns,
			value.OrganizationID, value.SchoolID, value.Body, value.ConsultantNumber, value.ClientNumber, value.CostCenter, accountID).Scan(ctx, &rows)
	} else {
		err = db.NewRaw(`UPDATE workforce.payroll_employers SET consultant_number = ?, client_number = ?, cost_center = ?, updated_by = ?
			WHERE organization_id = ? AND school_id = ? AND body = ?
			RETURNING `+payrollEmployerColumns,
			value.ConsultantNumber, value.ClientNumber, value.CostCenter, accountID, value.OrganizationID, value.SchoolID, value.Body).Scan(ctx, &rows)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.TraegerPayrollEmployer{}, false, fmt.Errorf("workforce postgres: save payroll employer: %w", err)
	}
	if len(rows) == 0 {
		return domain.TraegerPayrollEmployer{}, false, nil
	}
	return rows[0].toDomain(), true, nil
}

// SetLinkEmployerNumber sets the personnel number with body at the
// Einsatzort of the record at the school.
func (s *TraegerStaffStore) SetLinkEmployerNumber(ctx context.Context, organizationID, recordID, schoolID int64, body string, number *string) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return err
	}
	var employerBody *string
	if number != nil {
		employerBody = &body
	}
	result, err := db.ExecContext(ctx, `UPDATE workforce.staff_record_links SET employer_body = ?, employer_personnel_number = ?
		WHERE organization_id = ? AND staff_record_id = ? AND school_id = ?`, employerBody, number, organizationID, recordID, schoolID)
	if err != nil {
		return fmt.Errorf("workforce postgres: set employer personnel number: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected == 0 {
		return domain.ErrTraegerStaffRecordMissing
	}
	return nil
}
