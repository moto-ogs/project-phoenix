package audit

import (
	"context"
	"time"

	audit "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

const fileEventTableExpr = `audit.file_event_ledger AS "file_event"`

type fileEventRepository struct {
	runtime Runtime
	now     func() time.Time
}

// NewFileEventRepository creates the append-only file storage trail
// repository (#2596).
func NewFileEventRepository(runtime Runtime, now func() time.Time) audit.FileEventRepository {
	return &fileEventRepository{runtime: requireRuntime(runtime), now: now}
}

func (r *fileEventRepository) Create(ctx context.Context, event *audit.FileEvent) error {
	return NewAppender(r.runtime, r.now).Append(ctx, event)
}

func (r *fileEventRepository) ListRecent(ctx context.Context, limit int) ([]*audit.FileEvent, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows []*audit.FileEvent
	ambientDB1, databaseErr1 := runtimeDB(ctx, r.runtime)
	if databaseErr1 != nil {
		return *new([]*audit.FileEvent), databaseErr1
	}
	query := ambientDB1.NewSelect().
		Model(&rows).
		ModelTableExpr(fileEventTableExpr).
		OrderExpr(`"file_event".created_at DESC, "file_event".id DESC`).
		Limit(int64(limit))
	query = tenantQuery(ctx, r.runtime, query, "file_event")
	if err := query.Scan(ctx); err != nil {
		return nil, wrapDatabase("list file events", err)
	}
	return rows, nil
}
