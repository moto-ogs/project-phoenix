package audit

import (
	"context"
	"fmt"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

// ClassListEntryChangeRepository is the append-only writer for
// audit.class_list_entry_changes (#2382).
type ClassListEntryChangeRepository struct {
	runtime Runtime
	now     func() time.Time
}

// NewClassListEntryChangeRepository creates the audit writer.
func NewClassListEntryChangeRepository(runtime Runtime, now func() time.Time) auditModels.ClassListEntryChangeRepository {
	return &ClassListEntryChangeRepository{runtime: requireRuntime(runtime), now: now}
}

// Create inserts one change row.
func (r *ClassListEntryChangeRepository) Create(ctx context.Context, change *auditModels.ClassListEntryChange) error {
	if change == nil {
		return fmt.Errorf("class list entry change audit event is required")
	}
	if err := change.Validate(); err != nil {
		return fmt.Errorf("invalid class list entry change audit event: %w", err)
	}
	return NewAppender(r.runtime, r.now).Append(ctx, change)
}

// ListByEntryID returns the trail of one entry, newest first.
func (r *ClassListEntryChangeRepository) ListByEntryID(ctx context.Context, entryID int64) ([]*auditModels.ClassListEntryChange, error) {
	var changes []*auditModels.ClassListEntryChange
	ambientDB1, databaseErr1 := runtimeDB(ctx, r.runtime)
	if databaseErr1 != nil {
		return *new([]*auditModels.ClassListEntryChange), databaseErr1
	}
	err := ambientDB1.NewSelect().
		Model(&changes).
		ModelTableExpr(`audit.class_list_entry_changes AS "class_list_entry_change"`).
		Where(`"class_list_entry_change".entry_id = ?`, entryID).
		OrderExpr(`"class_list_entry_change".occurred_at DESC, "class_list_entry_change".id DESC`).
		Scan(ctx)
	if err != nil {
		return nil, fmt.Errorf("list class list entry changes: %w", err)
	}
	return changes, nil
}
