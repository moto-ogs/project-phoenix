package users

import (
	"context"
	"fmt"
	"time"

	userModels "github.com/moto-ogs/project-phoenix/modules/peopledirectory/internal/rows"
	ports "github.com/moto-ogs/project-phoenix/modules/peopledirectory/ports"
)

const parentRequestEventTable = "users.parent_request_events"

// parentRequestEventDefaultLimit bounds an unbounded student query so one
// child with a long history cannot pull an unpaged table scan into a request.
const parentRequestEventDefaultLimit = 200

type ParentRequestEventRepository struct {
	runtime Runtime
	now     func() time.Time // stamps created_at (ADR 0281)
}

func NewParentRequestEventRepository(runtime Runtime, now func() time.Time) ports.ParentRequestEventRecords {
	return &ParentRequestEventRepository{runtime: requireRuntime(runtime), now: requireClock(now)}
}

// Create overrides the generic insert so created_at is the owner's instant of
// each event, also when several are written inside one transaction; the
// history orders them by ID.
func (r *ParentRequestEventRepository) Create(ctx context.Context, event *userModels.ParentRequestEvent) error {
	if event == nil {
		return fmt.Errorf("parent request event cannot be nil")
	}
	ensureTenantID(ctx, r.runtime, event)
	if event.Payload == nil {
		event.Payload = map[string]any{}
	}
	at := r.now()
	ambientDB1, databaseErr1 := r.runtime.DB(ctx)
	if databaseErr1 != nil {
		return databaseErr1
	}
	if _, err := ambientDB1.NewInsert().Model(event).
		ModelTableExpr(parentRequestEventTable).
		Value("created_at", "?", at).
		Value("updated_at", "?", at).
		Exec(ctx); err != nil {
		return &ports.DatabaseError{Op: "create parent request event", Err: translateNotFound(err)}
	}
	return nil
}

// ListForRequest returns one request's events oldest first — the order the
// history is read in.
func (r *ParentRequestEventRepository) ListForRequest(
	ctx context.Context,
	requestType string,
	requestID int64,
) ([]*userModels.ParentRequestEvent, error) {
	rows := make([]*userModels.ParentRequestEvent, 0)
	ambientDB2, databaseErr2 := r.runtime.DB(ctx)
	if databaseErr2 != nil {
		return *new([]*userModels.ParentRequestEvent), databaseErr2
	}
	query := ambientDB2.NewSelect().
		Model(&rows).
		ModelTableExpr(`users.parent_request_events AS "parent_request_event"`).
		Where(`"parent_request_event".request_type = ?`, requestType).
		Where(`"parent_request_event".request_id = ?`, requestID).
		OrderExpr(`"parent_request_event".id`)
	query = withTenantFilter(ctx, r.runtime, query, "parent_request_event")
	if err := query.Scan(ctx); err != nil {
		return nil, &ports.DatabaseError{Op: "list parent request events", Err: translateNotFound(err)}
	}
	return rows, nil
}

// ListForStudent returns one child's events newest first.
func (r *ParentRequestEventRepository) ListForStudent(
	ctx context.Context,
	studentID int64,
	limit int,
) ([]*userModels.ParentRequestEvent, error) {
	if limit <= 0 || limit > parentRequestEventDefaultLimit {
		limit = parentRequestEventDefaultLimit
	}
	rows := make([]*userModels.ParentRequestEvent, 0)
	ambientDB3, databaseErr3 := r.runtime.DB(ctx)
	if databaseErr3 != nil {
		return *new([]*userModels.ParentRequestEvent), databaseErr3
	}
	query := ambientDB3.NewSelect().
		Model(&rows).
		ModelTableExpr(`users.parent_request_events AS "parent_request_event"`).
		Where(`"parent_request_event".student_id = ?`, studentID).
		OrderExpr(`"parent_request_event".id DESC`).
		Limit(int64(limit))
	query = withTenantFilter(ctx, r.runtime, query, "parent_request_event")
	if err := query.Scan(ctx); err != nil {
		return nil, &ports.DatabaseError{Op: "list student parent request events", Err: translateNotFound(err)}
	}
	return rows, nil
}
