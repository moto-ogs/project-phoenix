package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// The Nachweise of the Personalstamm (#4707, ADR 0089 section 7) in the
// schema workforce. Kinds, proofs and mappings join the Träger transaction;
// the school's kinds and the status a school sees join that school's tenant
// transaction; the list of released Träger joins the administrative one.

const staffProofTypeLiveNameIndex = "uq_workforce_staff_proof_types_live_name"

type staffProofTypeRow struct {
	ID                int64      `bun:"id"`
	OrganizationID    int64      `bun:"organization_id"`
	StandardKey       *string    `bun:"standard_key"`
	Name              string     `bun:"name"`
	ValidityMonths    *int       `bun:"validity_months"`
	ReminderLeadWeeks int        `bun:"reminder_lead_weeks"`
	Mandatory         bool       `bun:"mandatory"`
	SortOrder         int        `bun:"sort_order"`
	ArchivedAt        *time.Time `bun:"archived_at"`
}

func (r staffProofTypeRow) toDomain() domain.TraegerProofType {
	kind := domain.TraegerProofType{
		ID: r.ID, OrganizationID: r.OrganizationID, Name: r.Name, ValidityMonths: r.ValidityMonths,
		ReminderLeadWeeks: r.ReminderLeadWeeks, Mandatory: r.Mandatory, SortOrder: r.SortOrder, ArchivedAt: r.ArchivedAt,
	}
	if r.StandardKey != nil {
		kind.StandardKey = *r.StandardKey
	}
	return kind
}

const staffProofTypeColumns = `id, organization_id, standard_key, name, validity_months, reminder_lead_weeks, mandatory, sort_order, archived_at`

// EnsureStandardProofTypes adds the standard kinds the Träger does not have
// yet in one statement; renamed or archived ones stay as they are.
func (s *TraegerStaffStore) EnsureStandardProofTypes(ctx context.Context, organizationID int64, kinds []domain.TraegerProofType) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil || len(kinds) == 0 {
		return err
	}
	keys, names, validity, leads, mandatory, order := make([]string, len(kinds)), make([]string, len(kinds)),
		make([]*int, len(kinds)), make([]int, len(kinds)), make([]bool, len(kinds)), make([]int, len(kinds))
	for i, kind := range kinds {
		keys[i], names[i], validity[i], leads[i], mandatory[i], order[i] = kind.StandardKey, kind.Name, kind.ValidityMonths, kind.ReminderLeadWeeks, kind.Mandatory, kind.SortOrder
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workforce.staff_proof_types
		(organization_id, standard_key, name, validity_months, reminder_lead_weeks, mandatory, sort_order)
		SELECT ?, kind.standard_key, kind.name, kind.validity_months, kind.reminder_lead_weeks, kind.mandatory, kind.sort_order
		FROM unnest(?::varchar[], ?::varchar[], ?::integer[], ?::integer[], ?::boolean[], ?::integer[])
			AS kind (standard_key, name, validity_months, reminder_lead_weeks, mandatory, sort_order)
		ON CONFLICT (organization_id, standard_key) WHERE standard_key IS NOT NULL DO NOTHING`,
		organizationID, pgdialect.Array(keys), pgdialect.Array(names), pgdialect.Array(validity), pgdialect.Array(leads),
		pgdialect.Array(mandatory), pgdialect.Array(order)); err != nil {
		return fmt.Errorf("workforce postgres: ensure standard proof types: %w", err)
	}
	return nil
}

// ListProofTypes returns every kind of the Träger: live ones in their
// order, archived ones after.
func (s *TraegerStaffStore) ListProofTypes(ctx context.Context, organizationID int64) ([]domain.TraegerProofType, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []staffProofTypeRow
	if err := db.NewRaw(`SELECT `+staffProofTypeColumns+` FROM workforce.staff_proof_types WHERE organization_id = ?
		ORDER BY archived_at IS NOT NULL, sort_order, id`, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list proof types: %w", err)
	}
	kinds := make([]domain.TraegerProofType, 0, len(rows))
	for _, row := range rows {
		kinds = append(kinds, row.toDomain())
	}
	return kinds, nil
}

// LockProofType locks one kind of the Träger until the transaction ends and
// returns it as committed; an unknown ID fails with
// ErrTraegerProofTypeMissing. The lock is FOR NO KEY UPDATE: it serializes
// the writers of the kind, while a proof or a mapping that references it
// (FOR KEY SHARE through its foreign key) is not held up. The update of a
// kind changes no key column.
func (s *TraegerStaffStore) LockProofType(ctx context.Context, organizationID, id int64) (domain.TraegerProofType, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return domain.TraegerProofType{}, err
	}
	if err := tenant.OrderLock(ctx, tenant.LockLeaf, "workforce.staff_proof_types"); err != nil {
		return domain.TraegerProofType{}, err
	}
	var rows []staffProofTypeRow
	if err := db.NewRaw(`SELECT `+staffProofTypeColumns+` FROM workforce.staff_proof_types
		WHERE organization_id = ? AND id = ? FOR NO KEY UPDATE`, organizationID, id).Scan(ctx, &rows); err != nil {
		return domain.TraegerProofType{}, fmt.Errorf("workforce postgres: lock proof type: %w", err)
	}
	if len(rows) == 0 {
		return domain.TraegerProofType{}, domain.ErrTraegerProofTypeMissing
	}
	return rows[0].toDomain(), nil
}

// SaveProofType inserts a kind without an ID after the existing ones or
// rewrites one; a live name taken fails with ErrTraegerProofTypeNameTaken,
// an unknown ID with ErrTraegerProofTypeMissing.
func (s *TraegerStaffStore) SaveProofType(ctx context.Context, kind domain.TraegerProofType) (domain.TraegerProofType, error) {
	db, err := traegerStaffDB(ctx, kind.OrganizationID)
	if err != nil {
		return domain.TraegerProofType{}, err
	}
	var rows []staffProofTypeRow
	if kind.ID == 0 {
		err = db.NewRaw(`INSERT INTO workforce.staff_proof_types (organization_id, name, validity_months, reminder_lead_weeks, mandatory, sort_order)
			SELECT ?, ?, ?, ?, ?, COALESCE(MAX(sort_order) + 1, 0) FROM workforce.staff_proof_types WHERE organization_id = ?
			RETURNING `+staffProofTypeColumns,
			kind.OrganizationID, kind.Name, kind.ValidityMonths, kind.ReminderLeadWeeks, kind.Mandatory, kind.OrganizationID).Scan(ctx, &rows)
	} else {
		err = db.NewRaw(`UPDATE workforce.staff_proof_types SET name = ?, validity_months = ?, reminder_lead_weeks = ?, mandatory = ?,
			archived_at = CASE WHEN ? THEN COALESCE(archived_at, ?) ELSE NULL END
			WHERE organization_id = ? AND id = ? RETURNING `+staffProofTypeColumns,
			kind.Name, kind.ValidityMonths, kind.ReminderLeadWeeks, kind.Mandatory, kind.ArchivedAt != nil, kind.ArchivedAt,
			kind.OrganizationID, kind.ID).Scan(ctx, &rows)
	}
	switch {
	case isUniqueViolationOn(err, staffProofTypeLiveNameIndex):
		return domain.TraegerProofType{}, domain.ErrTraegerProofTypeNameTaken
	case err != nil:
		return domain.TraegerProofType{}, fmt.Errorf("workforce postgres: save proof type: %w", err)
	case len(rows) == 0:
		return domain.TraegerProofType{}, domain.ErrTraegerProofTypeMissing
	}
	return rows[0].toDomain(), nil
}

type staffProofRow struct {
	bun.BaseModel       `bun:"table:workforce.staff_proofs,alias:staff_proof"`
	ID                  int64          `bun:"id"`
	OrganizationID      int64          `bun:"organization_id"`
	RecordID            int64          `bun:"staff_record_id"`
	TypeID              int64          `bun:"type_id"`
	PresentedOn         calendar.Date  `bun:"presented_on,type:date"`
	IssuedOn            *calendar.Date `bun:"issued_on,type:date"`
	NoRelevantEntry     bool           `bun:"no_relevant_entry"`
	ExpiresOn           *calendar.Date `bun:"expires_on,type:date"`
	LeadRemindedFor     *calendar.Date `bun:"lead_reminded_for,type:date"`
	ExpiryRemindedFor   *calendar.Date `bun:"expiry_reminded_for,type:date"`
	RecordedByAccountID int64          `bun:"recorded_by_account_id"`
	UpdatedAt           time.Time      `bun:"updated_at"`
}

func dateText(day *calendar.Date) string {
	if day == nil {
		return ""
	}
	return day.String()
}

func optionalProofDate(value string) (*calendar.Date, error) {
	if value == "" {
		return nil, nil
	}
	day, err := calendar.ParseDate(value)
	if err != nil {
		return nil, err
	}
	return &day, nil
}

func textOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (r staffProofRow) toDomain() domain.TraegerProof {
	return domain.TraegerProof{
		ID: r.ID, OrganizationID: r.OrganizationID, RecordID: r.RecordID, TypeID: r.TypeID,
		PresentedOn: r.PresentedOn.String(), IssuedOn: dateText(r.IssuedOn), NoRelevantEntry: r.NoRelevantEntry,
		ExpiresOn: dateText(r.ExpiresOn), LeadRemindedFor: dateText(r.LeadRemindedFor), ExpiryRemindedFor: dateText(r.ExpiryRemindedFor),
		RecordedByAccountID: r.RecordedByAccountID, UpdatedAt: r.UpdatedAt,
	}
}

// ListProofs returns the proofs of the given records, of every record of the
// Träger when recordIDs is nil.
func (s *TraegerStaffStore) ListProofs(ctx context.Context, organizationID int64, recordIDs []int64) ([]domain.TraegerProof, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []staffProofRow
	if recordIDs == nil {
		err = db.NewRaw(`SELECT id, organization_id, staff_record_id, type_id, presented_on, issued_on, no_relevant_entry, expires_on,
			lead_reminded_for, expiry_reminded_for, recorded_by_account_id, updated_at
			FROM workforce.staff_proofs WHERE organization_id = ? ORDER BY staff_record_id, type_id`, organizationID).Scan(ctx, &rows)
	} else {
		err = db.NewRaw(`SELECT id, organization_id, staff_record_id, type_id, presented_on, issued_on, no_relevant_entry, expires_on,
			lead_reminded_for, expiry_reminded_for, recorded_by_account_id, updated_at
			FROM workforce.staff_proofs WHERE organization_id = ? AND staff_record_id = ANY(?) ORDER BY staff_record_id, type_id`,
			organizationID, pgdialect.Array(recordIDs)).Scan(ctx, &rows)
	}
	if err != nil {
		return nil, fmt.Errorf("workforce postgres: list proofs: %w", err)
	}
	proofs := make([]domain.TraegerProof, 0, len(rows))
	for _, row := range rows {
		proofs = append(proofs, row.toDomain())
	}
	return proofs, nil
}

// SaveProof records the proof of a kind at a record, or replaces the one
// it holds: a renewal keeps no earlier days.
func (s *TraegerStaffStore) SaveProof(ctx context.Context, proof domain.TraegerProof) error {
	db, err := traegerStaffDB(ctx, proof.OrganizationID)
	if err != nil {
		return err
	}
	presented, err := calendar.ParseDate(proof.PresentedOn)
	if err != nil {
		return fmt.Errorf("workforce postgres: proof presented_on: %w", err)
	}
	issued, err := optionalProofDate(proof.IssuedOn)
	if err != nil {
		return fmt.Errorf("workforce postgres: proof issued_on: %w", err)
	}
	expires, err := optionalProofDate(proof.ExpiresOn)
	if err != nil {
		return fmt.Errorf("workforce postgres: proof expires_on: %w", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workforce.staff_proofs
		(organization_id, staff_record_id, type_id, presented_on, issued_on, no_relevant_entry, expires_on, recorded_by_account_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (staff_record_id, type_id) DO UPDATE SET presented_on = EXCLUDED.presented_on, issued_on = EXCLUDED.issued_on,
			no_relevant_entry = EXCLUDED.no_relevant_entry, expires_on = EXCLUDED.expires_on,
			recorded_by_account_id = EXCLUDED.recorded_by_account_id`,
		proof.OrganizationID, proof.RecordID, proof.TypeID, presented, issued, proof.NoRelevantEntry, expires,
		proof.RecordedByAccountID); err != nil {
		return fmt.Errorf("workforce postgres: save proof: %w", err)
	}
	return nil
}

// DeleteProof removes the proof of a kind at a record; one it does not hold
// fails with ErrTraegerProofMissing.
func (s *TraegerStaffStore) DeleteProof(ctx context.Context, organizationID, recordID, typeID int64) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return err
	}
	result, err := db.ExecContext(ctx, `DELETE FROM workforce.staff_proofs WHERE organization_id = ? AND staff_record_id = ? AND type_id = ?`,
		organizationID, recordID, typeID)
	if err != nil {
		return fmt.Errorf("workforce postgres: delete proof: %w", err)
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return domain.ErrTraegerProofMissing
	}
	return nil
}

// ClaimProofReminder records that the reminder stage went out for the
// expiry date and reports whether this call claimed it.
func (s *TraegerStaffStore) ClaimProofReminder(ctx context.Context, organizationID, proofID int64, stage, expiresOn string) (bool, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return false, err
	}
	expiry, err := calendar.ParseDate(expiresOn)
	if err != nil {
		return false, fmt.Errorf("workforce postgres: proof reminder expiry: %w", err)
	}
	var result sql.Result
	if stage == domain.QualificationReminderExpiry {
		result, err = db.ExecContext(ctx, `UPDATE workforce.staff_proofs SET expiry_reminded_for = ?
			WHERE organization_id = ? AND id = ? AND expires_on = ? AND expiry_reminded_for IS DISTINCT FROM ?`,
			expiry, organizationID, proofID, expiry, expiry)
	} else {
		result, err = db.ExecContext(ctx, `UPDATE workforce.staff_proofs SET lead_reminded_for = ?
			WHERE organization_id = ? AND id = ? AND expires_on = ? AND lead_reminded_for IS DISTINCT FROM ?`,
			expiry, organizationID, proofID, expiry, expiry)
	}
	if err != nil {
		return false, fmt.Errorf("workforce postgres: claim proof reminder: %w", err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

// ListProofTypeMappings returns every mapping of the Träger's schools.
func (s *TraegerStaffStore) ListProofTypeMappings(ctx context.Context, organizationID int64) ([]domain.TraegerProofTypeMapping, error) {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []domain.TraegerProofTypeMapping
	if err := db.NewRaw(`SELECT school_id, school_type_id, proof_type_id FROM workforce.staff_proof_type_mappings
		WHERE organization_id = ? ORDER BY school_id, school_type_id`, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list proof type mappings: %w", err)
	}
	return rows, nil
}

// SaveProofTypeMapping maps a school kind onto a Träger kind, or with a zero
// ProofTypeID removes its mapping. now stamps the mapping.
func (s *TraegerStaffStore) SaveProofTypeMapping(ctx context.Context, organizationID, accountID int64, mapping domain.TraegerProofTypeMapping, now time.Time) error {
	db, err := traegerStaffDB(ctx, organizationID)
	if err != nil {
		return err
	}
	if mapping.ProofTypeID == 0 {
		_, err = db.ExecContext(ctx, `DELETE FROM workforce.staff_proof_type_mappings WHERE organization_id = ? AND school_id = ? AND school_type_id = ?`,
			organizationID, mapping.SchoolID, mapping.SchoolTypeID)
	} else {
		_, err = db.ExecContext(ctx, `INSERT INTO workforce.staff_proof_type_mappings (organization_id, school_id, school_type_id, proof_type_id, mapped_by_account_id, mapped_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (school_id, school_type_id) DO UPDATE SET proof_type_id = EXCLUDED.proof_type_id,
				mapped_by_account_id = EXCLUDED.mapped_by_account_id, mapped_at = EXCLUDED.mapped_at
			WHERE workforce.staff_proof_type_mappings.organization_id = EXCLUDED.organization_id`,
			organizationID, mapping.SchoolID, mapping.SchoolTypeID, mapping.ProofTypeID, accountID, now)
	}
	if err != nil {
		return fmt.Errorf("workforce postgres: save proof type mapping: %w", err)
	}
	return nil
}

// SchoolProofKinds returns the live kinds of the school of the tenant
// transaction (#4808), by their order.
func (s *TraegerStaffStore) SchoolProofKinds(ctx context.Context) ([]domain.QualificationType, error) {
	db, schoolID, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID   int64  `bun:"id"`
		Name string `bun:"name"`
	}
	if err := db.NewRaw(`SELECT id, name FROM users.staff_qualification_types WHERE tenant_id = ? AND archived_at IS NULL
		ORDER BY sort_order, id`, schoolID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: list school proof kinds: %w", err)
	}
	kinds := make([]domain.QualificationType, 0, len(rows))
	for _, row := range rows {
		kinds = append(kinds, domain.QualificationType{ID: row.ID, TenantID: schoolID, Name: row.Name})
	}
	return kinds, nil
}

// SchoolTraegerProofStatus returns what the school of the tenant
// transaction sees of the Träger's proofs of its kept employments (ADR 0089
// section 7), through the function that filters on that school.
func (s *TraegerStaffStore) SchoolTraegerProofStatus(ctx context.Context) ([]domain.SchoolTraegerProofStatus, error) {
	db, _, err := schoolStaffDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		MembershipID      int64   `bun:"membership_id"`
		ProofTypeID       int64   `bun:"proof_type_id"`
		TypeName          string  `bun:"type_name"`
		Mandatory         bool    `bun:"mandatory"`
		Held              bool    `bun:"held"`
		ExpiresOn         *string `bun:"expires_on"`
		ReminderLeadWeeks int     `bun:"reminder_lead_weeks"`
		SchoolTypeIDs     []int64 `bun:"school_type_ids,array"`
	}
	if err := db.NewRaw(`SELECT membership_id, proof_type_id, type_name, mandatory, held, expires_on, reminder_lead_weeks, school_type_ids
		FROM workforce.school_traeger_proof_status()`).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("workforce postgres: read the Träger's proof status: %w", err)
	}
	result := make([]domain.SchoolTraegerProofStatus, 0, len(rows))
	for _, row := range rows {
		result = append(result, domain.SchoolTraegerProofStatus{
			StaffID: row.MembershipID, ProofTypeID: row.ProofTypeID, TypeName: row.TypeName, Mandatory: row.Mandatory, Held: row.Held,
			ExpiresOn: textOrEmpty(row.ExpiresOn), ReminderLeadWeeks: row.ReminderLeadWeeks, SchoolTypeIDs: row.SchoolTypeIDs,
		})
	}
	return result, nil
}
