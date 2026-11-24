package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Schulträger and Gemeinde of the schools of a Träger (#4811). The table
// carries organization_id and the Träger policy on app.current_org_id (ADR
// 0105): every statement here runs in the Träger transaction of the Träger
// it names, and names it once more in its own filter.

type schoolPartyRow struct {
	ID            int64     `bun:"id"`
	SchoolID      int64     `bun:"school_id"`
	Kind          string    `bun:"kind"`
	Name          string    `bun:"name"`
	Street        string    `bun:"street"`
	PostalCode    string    `bun:"postal_code"`
	City          string    `bun:"city"`
	ContactName   string    `bun:"contact_name"`
	ContactPhone  string    `bun:"contact_phone"`
	ContactEmail  string    `bun:"contact_email"`
	CreditorID    string    `bun:"creditor_id"`
	AccountHolder string    `bun:"account_holder"`
	IBAN          string    `bun:"iban"`
	BIC           string    `bun:"bic"`
	BankName      string    `bun:"bank_name"`
	UpdatedAt     time.Time `bun:"updated_at"`
}

func (r schoolPartyRow) toDomain() organizationtenancy.SchoolParty {
	party := organizationtenancy.SchoolParty{
		ID: ident.ID(r.ID), SchoolID: ident.ID(r.SchoolID),
		Kind: organizationtenancy.ResponsibleBody(r.Kind), Name: r.Name, Street: r.Street, PostalCode: r.PostalCode, City: r.City,
		ContactName: r.ContactName, ContactPhone: r.ContactPhone, ContactEmail: r.ContactEmail, CreditorID: r.CreditorID,
		AccountHolder: r.AccountHolder, IBAN: r.IBAN, BIC: r.BIC, BankName: r.BankName, UpdatedAt: r.UpdatedAt,
	}
	party.Version = organizationtenancy.SchoolPartyVersion(party)
	return party
}

type schoolNameRow struct {
	ID   int64  `bun:"id"`
	Name string `bun:"name"`
}

const (
	traegerSchoolNamesQuery = `SELECT id, name FROM platform.schools
		WHERE organization_id = ? AND deleted_at IS NULL
		ORDER BY name, id`
	schoolPartyColumns = `id, school_id, kind, name, street, postal_code, city, contact_name, contact_phone, contact_email,
		creditor_id, account_holder, iban, bic, bank_name, updated_at`
	listSchoolPartiesQuery = `SELECT ` + schoolPartyColumns + ` FROM platform.school_responsible_parties
		WHERE organization_id = ? AND school_id IN (?)
		ORDER BY school_id, kind`
	// saveSchoolPartyQuery inserts the body of the school or overwrites
	// it; the row's trigger stamps updated_at on the update.
	saveSchoolPartyQuery = `INSERT INTO platform.school_responsible_parties
		(organization_id, school_id, kind, name, street, postal_code, city, contact_name, contact_phone, contact_email,
			creditor_id, account_holder, iban, bic, bank_name, created_by, updated_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (organization_id, school_id, kind) DO UPDATE SET
			name = EXCLUDED.name, street = EXCLUDED.street, postal_code = EXCLUDED.postal_code, city = EXCLUDED.city,
			contact_name = EXCLUDED.contact_name, contact_phone = EXCLUDED.contact_phone, contact_email = EXCLUDED.contact_email,
			creditor_id = EXCLUDED.creditor_id, account_holder = EXCLUDED.account_holder, iban = EXCLUDED.iban,
			bic = EXCLUDED.bic, bank_name = EXCLUDED.bank_name, updated_by = EXCLUDED.updated_by
		RETURNING ` + schoolPartyColumns
	deleteSchoolPartyQuery = `DELETE FROM platform.school_responsible_parties
		WHERE organization_id = ? AND school_id = ? AND kind = ?`
)

// TraegerSchoolNames lists the undeleted schools of the Träger by name.
func (s *TraegerMasterDataStore) TraegerSchoolNames(ctx context.Context, organizationID int64) ([]organizationtenancy.TraegerSchoolName, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []schoolNameRow
	if err := db.NewRaw(traegerSchoolNamesQuery, organizationID).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("organization tenancy postgres: list Träger schools: %w", err)
	}
	schools := make([]organizationtenancy.TraegerSchoolName, 0, len(rows))
	for _, row := range rows {
		schools = append(schools, organizationtenancy.TraegerSchoolName(row))
	}
	return schools, nil
}

// SchoolParties reads the stored bodies of the given schools.
func (s *TraegerMasterDataStore) SchoolParties(ctx context.Context, organizationID int64, schoolIDs []int64) ([]organizationtenancy.SchoolParty, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	parties := []organizationtenancy.SchoolParty{}
	if len(schoolIDs) == 0 {
		return parties, nil
	}
	var rows []schoolPartyRow
	if err := db.NewRaw(listSchoolPartiesQuery, organizationID, bun.List(schoolIDs)).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("organization tenancy postgres: list school parties: %w", err)
	}
	for _, row := range rows {
		parties = append(parties, row.toDomain())
	}
	return parties, nil
}

// SaveSchoolParty inserts the body of the school or overwrites it.
func (s *TraegerMasterDataStore) SaveSchoolParty(ctx context.Context, organizationID, accountID, schoolID int64, kind organizationtenancy.ResponsibleBody,
	input organizationtenancy.SchoolPartyInput) (organizationtenancy.SchoolParty, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return organizationtenancy.SchoolParty{}, err
	}
	actor := traegerActor(accountID)
	var rows []schoolPartyRow
	err = db.NewRaw(saveSchoolPartyQuery, organizationID, schoolID, string(kind), input.Name, input.Street, input.PostalCode, input.City,
		input.ContactName, input.ContactPhone, input.ContactEmail, input.CreditorID, input.AccountHolder, input.IBAN, input.BIC,
		input.BankName, actor, actor).Scan(ctx, &rows)
	if err != nil || len(rows) != 1 {
		return organizationtenancy.SchoolParty{}, fmt.Errorf("organization tenancy postgres: save school party (%d rows): %w", len(rows), err)
	}
	return rows[0].toDomain(), nil
}

// DeleteSchoolParty deletes the body of the school.
func (s *TraegerMasterDataStore) DeleteSchoolParty(ctx context.Context, organizationID, schoolID int64, kind organizationtenancy.ResponsibleBody) (bool, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return false, err
	}
	result, err := db.ExecContext(ctx, deleteSchoolPartyQuery, organizationID, schoolID, string(kind))
	if err != nil {
		return false, fmt.Errorf("organization tenancy postgres: delete school party: %w", err)
	}
	deleted, err := result.RowsAffected()
	return deleted > 0, err
}
