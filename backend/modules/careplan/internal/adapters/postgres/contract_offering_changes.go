package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/tenant"
)

var _ careplan.ContractOfferingChanges = ContractOfferingStore{}

type approvedOfferingChangeRow struct {
	ID             int64           `bun:"id"`
	RequestChildID int64           `bun:"request_child_id"`
	SubmittedBy    int64           `bun:"submitted_by"`
	SubmittedAt    time.Time       `bun:"submitted_at"`
	EffectiveFrom  careplan.Date   `bun:"effective_from,type:date"`
	Payload        json.RawMessage `bun:"payload"`
}

// ApprovedOfferingChanges lists the applied requests of the children for
// the Betreuungsvertrag (#4816) in one statement, in the caller's tenant
// transaction. A request whose stored selection cannot be read is an error:
// it must never pass as a request for nothing.
func (ContractOfferingStore) ApprovedOfferingChanges(ctx context.Context, requestChildIDs []int64) ([]careplan.ApprovedOfferingChange, error) {
	tx, tenantID, err := tenant.CurrentTenantTransaction[bun.Tx](ctx)
	if err != nil {
		return nil, fmt.Errorf("care plan postgres: approved offering changes need the school transaction: %w", err)
	}
	if len(requestChildIDs) == 0 {
		return []careplan.ApprovedOfferingChange{}, nil
	}
	var rows []approvedOfferingChangeRow
	if err := tx.NewRaw(`SELECT id, request_child_id, submitted_by, submitted_at, effective_from, payload
		FROM enrollment.offering_change_requests
		WHERE tenant_id = ? AND request_child_id = ANY(?::bigint[]) AND status = ? AND applied_at IS NOT NULL
		ORDER BY request_child_id, id`, tenantID, pgdialect.Array(requestChildIDs), careplan.OfferingChangeApproved).Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("care plan postgres: approved offering changes: %w", err)
	}
	changes := make([]careplan.ApprovedOfferingChange, len(rows))
	for i, row := range rows {
		selections, err := careplan.ParseOfferingReviewSelections(row.Payload)
		if err != nil {
			return nil, fmt.Errorf("care plan postgres: approved offering change %d: %w", row.ID, err)
		}
		changes[i] = careplan.ApprovedOfferingChange{
			ID: row.ID, RequestChildID: row.RequestChildID, SubmittedBy: row.SubmittedBy, SubmittedAt: row.SubmittedAt,
			EffectiveFrom: row.EffectiveFrom, Selections: selections,
		}
	}
	return changes, nil
}
