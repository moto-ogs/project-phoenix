package careplan

import (
	"context"
	"time"
)

// ApprovedOfferingChange is a request of the parents to change their
// child's booked offerings that the school or the Träger-Büro approved, as
// the Betreuungsvertrag reads it (#4816, ADR 0322): the parents' own request
// proves their agreement to the contract version it made. SubmittedBy is the
// parents account that sent it at SubmittedAt, EffectiveFrom the day the
// approval applied it from, and Selections what the parents asked for from
// that day.
type ApprovedOfferingChange struct {
	ID             int64
	RequestChildID int64
	SubmittedBy    int64
	SubmittedAt    time.Time
	EffectiveFrom  Date
	Selections     []OfferingChangeSelection
}

// ContractOfferingChanges reads the approved offering changes of
// application children of the school whose tenant transaction the caller
// holds, by child and request. It reads requests, never writes one.
type ContractOfferingChanges interface {
	ApprovedOfferingChanges(ctx context.Context, requestChildIDs []int64) ([]ApprovedOfferingChange, error)
}
