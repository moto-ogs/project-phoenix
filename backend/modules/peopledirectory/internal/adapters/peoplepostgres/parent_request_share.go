package users

import (
	"context"
	"fmt"
	"time"

	userModels "github.com/moto-ogs/project-phoenix/modules/peopledirectory/internal/rows"
	ports "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
	"github.com/uptrace/bun"
)

const parentRequestShareTable = "users.parent_request_share_events"

type ParentRequestShareEventRepository struct {
	runtime Runtime
	now     func() time.Time // stamps created_at (ADR 0281)
}

func NewParentRequestShareEventRepository(runtime Runtime, now func() time.Time) ports.ParentRequestShareRecords {
	return &ParentRequestShareEventRepository{runtime: requireRuntime(runtime), now: requireClock(now)}
}

// Create overrides the generic insert so created_at is the owner's instant.
// Sharing and protection events live in separate tables, and visibility compares
// their creation order, so both ledgers stamp on the same clock (ADR 0281).
func (r *ParentRequestShareEventRepository) Create(ctx context.Context, event *userModels.ParentRequestShareEvent) error {
	if event == nil {
		return fmt.Errorf("parent request share event cannot be nil")
	}
	ensureTenantID(ctx, r.runtime, event)
	if event.RecipientAccountIDs == nil {
		event.RecipientAccountIDs = []int64{}
	}
	at := r.now()
	ambientDB1, databaseErr1 := r.runtime.DB(ctx)
	if databaseErr1 != nil {
		return databaseErr1
	}
	if _, err := ambientDB1.NewInsert().Model(event).
		ModelTableExpr(parentRequestShareTable).
		Value("created_at", "?", at).
		Value("updated_at", "?", at).
		Exec(ctx); err != nil {
		return &ports.DatabaseError{Op: "create parent request share event", Err: translateNotFound(err)}
	}
	return nil
}

// CurrentForStudents uses DISTINCT ON because the generic filter API cannot
// select the newest immutable event for each child, request type and request
// ID. One statement serves any number of children.
func (r *ParentRequestShareEventRepository) CurrentForStudents(ctx context.Context, studentIDs []int64) ([]*userModels.ParentRequestShareEvent, error) {
	rows := make([]*userModels.ParentRequestShareEvent, 0)
	if len(studentIDs) == 0 {
		return rows, nil
	}
	ambientDB2, databaseErr2 := r.runtime.DB(ctx)
	if databaseErr2 != nil {
		return *new([]*userModels.ParentRequestShareEvent), databaseErr2
	}
	query := ambientDB2.NewSelect().
		Model(&rows).
		ModelTableExpr(`users.parent_request_share_events AS "parent_request_share_event"`).
		Where(`"parent_request_share_event".student_id IN (?)`, bun.List(studentIDs)).
		DistinctOn(`"parent_request_share_event".student_id, "parent_request_share_event".request_type, "parent_request_share_event".request_id`).
		OrderExpr(`"parent_request_share_event".student_id, "parent_request_share_event".request_type, "parent_request_share_event".request_id, "parent_request_share_event".id DESC`)
	query = withTenantFilter(ctx, r.runtime, query, "parent_request_share_event")
	if err := query.Scan(ctx); err != nil {
		return nil, &ports.DatabaseError{Op: "list current parent request shares", Err: translateNotFound(err)}
	}
	return rows, nil
}
