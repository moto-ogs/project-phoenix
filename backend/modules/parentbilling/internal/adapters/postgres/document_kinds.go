package postgres

import (
	"context"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The kind of document of every service of a Träger (#4688) in
// parent_billing.document_kinds, under the Träger policy, per issuer
// (#8040). A service without a row keeps the default of its issuer.

type documentKindRow struct {
	bun.BaseModel `bun:"table:parent_billing.document_kinds"`

	OrganizationID int64     `bun:"organization_id,pk"`
	IssuerKey      string    `bun:"issuer_key,pk"`
	Service        string    `bun:"service,pk"`
	DocumentKind   string    `bun:"document_kind"`
	UpdatedAt      time.Time `bun:"updated_at,nullzero"`
}

// DocumentKinds reads the chosen kind of every issuer and service of the
// Träger, by issuer key and service (#8040).
func (s *Store) DocumentKinds(ctx context.Context, organizationID int64) (map[string]map[string]parentbilling.ServiceDocumentKind, error) {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	var rows []documentKindRow
	if err := db.NewSelect().Model(&rows).Where("organization_id = ?", organizationID).Scan(ctx); err != nil {
		return nil, err
	}
	kinds := map[string]map[string]parentbilling.ServiceDocumentKind{}
	for _, row := range rows {
		updatedAt := row.UpdatedAt
		if kinds[row.IssuerKey] == nil {
			kinds[row.IssuerKey] = map[string]parentbilling.ServiceDocumentKind{}
		}
		kinds[row.IssuerKey][row.Service] = parentbilling.ServiceDocumentKind{Service: row.Service, DocumentKind: row.DocumentKind, UpdatedAt: &updatedAt}
	}
	return kinds, nil
}

// SetDocumentKind stores or replaces the kind of a service of an issuer.
func (s *Store) SetDocumentKind(ctx context.Context, organizationID int64, issuerKey, service, documentKind string) error {
	db, err := traegerDB(ctx, organizationID)
	if err != nil {
		return err
	}
	row := &documentKindRow{OrganizationID: organizationID, IssuerKey: issuerKey, Service: service, DocumentKind: documentKind}
	_, err = db.NewInsert().Model(row).
		On("CONFLICT (organization_id, issuer_key, service) DO UPDATE").Set("document_kind = EXCLUDED.document_kind").
		Exec(ctx)
	return err
}
