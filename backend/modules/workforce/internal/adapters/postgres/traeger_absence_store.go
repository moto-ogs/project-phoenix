package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

// The Abwesenheitsarten and Kontingente of a Träger (#4710). The Träger
// methods join the Träger transaction of the type's Träger; the school
// methods the tenant transaction of one school, where Workforce carries each
// type of the Träger as a row of active.staff_absence_types.

const traegerAbsenceTypeNameIndex = "uq_workforce_absence_types_name"

type traegerAbsenceTypeRow struct {
	bun.BaseModel    `bun:"table:workforce.absence_types,alias:absence_type"`
	ID               int64     `bun:"id,pk,autoincrement"`
	OrganizationID   int64     `bun:"organization_id"`
	Name             string    `bun:"name"`
	AllowanceEnabled bool      `bun:"allowance_enabled"`
	StandardDays     float64   `bun:"standard_days"`
	CarryoverUntil   *string   `bun:"carryover_until"`
	Requestable      bool      `bun:"requestable"`
	IsActive         bool      `bun:"is_active"`
	CreatedAt        time.Time `bun:"created_at,nullzero,notnull"`
	UpdatedAt        time.Time `bun:"updated_at,nullzero,notnull"`
}

func (r traegerAbsenceTypeRow) toDomain() domain.TraegerAbsenceType {
	value := domain.TraegerAbsenceType{
		ID: r.ID, OrganizationID: r.OrganizationID, Name: r.Name, AllowanceEnabled: r.AllowanceEnabled,
		StandardDays: r.StandardDays, Requestable: r.Requestable, IsActive: r.IsActive, CreatedAt: r.CreatedAt,
	}
	if r.CarryoverUntil != nil {
		value.CarryoverUntil = *r.CarryoverUntil
	}
	return value
}

// ListTraegerAbsenceTypes returns the Träger's types by name.
func (s *TraegerStaffStore) ListTraegerAbsenceTypes(ctx context.Context, organizationID int64) ([]domain.TraegerAbsenceType, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []traegerAbsenceTypeRow
	if err := db.NewSelect().Model(&rows).Where("organization_id = ?", organizationID).OrderExpr("lower(name), id").Scan(ctx); err != nil {
		return nil, fmt.Errorf("workforce postgres: list traeger absence types: %w", err)
	}
	result := make([]domain.TraegerAbsenceType, 0, len(rows))
	for _, row := range rows {
		result = append(result, row.toDomain())
	}
	return result, nil
}

// FindTraegerAbsenceType returns one type of the Träger; forUpdate locks it.
func (s *TraegerStaffStore) FindTraegerAbsenceType(ctx context.Context, organizationID, id int64, forUpdate bool) (domain.TraegerAbsenceType, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return domain.TraegerAbsenceType{}, err
	}
	var rows []traegerAbsenceTypeRow
	query := db.NewSelect().Model(&rows).Where("organization_id = ? AND id = ?", organizationID, id)
	if forUpdate {
		if err := tenant.OrderLock(ctx, tenant.LockLeaf, "workforce.absence_types"); err != nil {
			return domain.TraegerAbsenceType{}, err
		}
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return domain.TraegerAbsenceType{}, fmt.Errorf("workforce postgres: find traeger absence type: %w", err)
	}
	if len(rows) == 0 {
		return domain.TraegerAbsenceType{}, workforce.ErrTraegerAbsenceTypeNotFound
	}
	return rows[0].toDomain(), nil
}

// SaveTraegerAbsenceType inserts a type without ID or rewrites the one
// with it, and returns the stored row.
func (s *TraegerStaffStore) SaveTraegerAbsenceType(ctx context.Context, value domain.TraegerAbsenceType) (domain.TraegerAbsenceType, error) {
	db, err := traegerStaffDB(ctx, value.OrganizationID)
	if err != nil {
		return domain.TraegerAbsenceType{}, err
	}
	row := &traegerAbsenceTypeRow{
		ID: value.ID, OrganizationID: value.OrganizationID, Name: value.Name, AllowanceEnabled: value.AllowanceEnabled,
		StandardDays: value.StandardDays, CarryoverUntil: nullableCarryover(value.CarryoverUntil),
		Requestable: value.Requestable, IsActive: value.IsActive,
	}
	if value.ID == 0 {
		_, err = db.NewInsert().Model(row).ExcludeColumn("id", "created_at", "updated_at").Returning("*").Exec(ctx)
	} else {
		_, err = db.NewUpdate().Model(row).
			Column("name", "allowance_enabled", "standard_days", "carryover_until", "requestable", "is_active").
			Where("organization_id = ? AND id = ?", value.OrganizationID, value.ID).Returning("*").Exec(ctx)
	}
	if isUniqueViolationOn(err, traegerAbsenceTypeNameIndex) {
		return domain.TraegerAbsenceType{}, workforce.ErrTraegerAbsenceTypeNameTaken
	}
	if err != nil {
		return domain.TraegerAbsenceType{}, fmt.Errorf("workforce postgres: save traeger absence type: %w", err)
	}
	return row.toDomain(), nil
}

// TraegerAbsencePool reads the Kontingente of the types of one record in
// the Träger transaction: the claims, holding them until the transaction
// ends with lock, and the bookings at every Einsatzort in [from, to].
func (s *TraegerStaffStore) TraegerAbsencePool(ctx context.Context, organizationID, recordID int64, typeIDs []int64, from, to string, lock bool) (map[int64]domain.AbsencePoolType, []domain.AbsencePoolUse, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, nil, err
	}
	claims, err := readAbsencePoolClaims(ctx, db, recordID, typeIDs, lock)
	if err != nil {
		return nil, nil, err
	}
	uses, err := readAbsencePoolUses(ctx, db, recordID, typeIDs, from, to)
	if err != nil {
		return nil, nil, err
	}
	return claims, uses, nil
}

// SaveTraegerAbsenceAllowance stores the days of one person, type and year
// with its trail entry.
func (s *TraegerStaffStore) SaveTraegerAbsenceAllowance(ctx context.Context, organizationID, accountID int64, input workforce.SetTraegerAbsenceAllowance, previous *float64) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workforce.absence_allowances (organization_id, staff_record_id, absence_type_id, year, entitled_days)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (organization_id, staff_record_id, absence_type_id, year)
		DO UPDATE SET entitled_days = EXCLUDED.entitled_days, updated_at = now()`,
		organizationID, input.RecordID, input.AbsenceTypeID, input.Year, input.EntitledDays); err != nil {
		return fmt.Errorf("workforce postgres: save traeger absence allowance: %w", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workforce.absence_allowance_changes
		(organization_id, staff_record_id, absence_type_id, year, old_entitled_days, new_entitled_days, reason, account_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		organizationID, input.RecordID, input.AbsenceTypeID, input.Year, previous, input.EntitledDays, input.Reason, accountID); err != nil {
		return fmt.Errorf("workforce postgres: trail traeger absence allowance: %w", err)
	}
	return nil
}

// SchoolAbsenceTypes returns every absence type of the school of the tenant
// transaction, its own and those of its Träger.
func (s *TraegerStaffStore) SchoolAbsenceTypes(ctx context.Context) ([]domain.StaffAbsenceType, error) {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []staffAbsenceTypeRow
	if err := db.NewSelect().Model(&rows).ModelTableExpr(tableStaffAbsenceTypes+` AS "staff_absence_type"`).
		Where(`"staff_absence_type".tenant_id = ?`, schoolID).OrderExpr(`"staff_absence_type".id`).Scan(ctx); err != nil {
		return nil, fmt.Errorf("workforce postgres: read school absence types: %w", err)
	}
	result := make([]domain.StaffAbsenceType, 0, len(rows))
	for _, row := range rows {
		result = append(result, staffAbsenceTypeToDomain(row))
	}
	return result, nil
}

// SchoolAbsenceTypeInUse reports whether an absence of the school uses its
// type schoolTypeID.
func (s *TraegerStaffStore) SchoolAbsenceTypeInUse(ctx context.Context, schoolTypeID int64) (bool, error) {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return false, err
	}
	exists, err := db.NewSelect().TableExpr("active.staff_absences").
		Where("tenant_id = ? AND absence_type_id = ?", schoolID, schoolTypeID).Exists(ctx)
	if err != nil {
		return false, fmt.Errorf("workforce postgres: check school absence type usage: %w", err)
	}
	return exists, nil
}

// CarryTraegerAbsenceType writes the Träger's type into the school's row
// schoolTypeID, or into a new row when it is 0. The school's deviation
// (offered, limit) and the row's wage type stay as they are.
func (s *TraegerStaffStore) CarryTraegerAbsenceType(ctx context.Context, schoolTypeID int64, value domain.TraegerAbsenceType) error {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return err
	}
	row := &staffAbsenceTypeRow{
		ID: schoolTypeID, TenantID: schoolID, Name: value.Name, BaseType: domain.AbsenceTypeOther, IsActive: value.IsActive,
		AllowanceEnabled: value.AllowanceEnabled, CarryoverUntil: nullableCarryover(value.CarryoverUntil),
		Requestable: value.Requestable, TraegerAbsenceTypeID: &value.ID, Offered: true,
	}
	if schoolTypeID == 0 {
		_, err = db.NewInsert().Model(row).ModelTableExpr(tableStaffAbsenceTypes).
			ExcludeColumn("id", "wage_type_id", "created_at", "updated_at").Exec(ctx)
	} else {
		_, err = db.NewUpdate().Model(row).ModelTableExpr(tableStaffAbsenceTypes+` AS "staff_absence_type"`).
			Column("name", "is_active", "allowance_enabled", "carryover_until", "requestable", "traeger_absence_type_id").
			Set("updated_at = NOW()").
			Where(`"staff_absence_type".tenant_id = ? AND "staff_absence_type".id = ?`, schoolID, schoolTypeID).Exec(ctx)
	}
	if isUniqueViolationOn(err, staffAbsenceTypeNameUniqueIndex) {
		return &domain.ConflictError{Kind: domain.ErrAbsenceTypeNameTaken, Cause: err}
	}
	if err != nil {
		return fmt.Errorf("workforce postgres: carry traeger absence type: %w", err)
	}
	return nil
}
