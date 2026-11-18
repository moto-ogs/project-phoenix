package audit

import (
	"context"
	"fmt"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

type TimeTrackingDeletionRepository struct {
	runtime Runtime
	now     func() time.Time
}

func NewTimeTrackingDeletionRepository(runtime Runtime, now func() time.Time) auditModels.TimeTrackingDeletionRepository {
	return &TimeTrackingDeletionRepository{runtime: requireRuntime(runtime), now: now}
}

func (r *TimeTrackingDeletionRepository) Create(ctx context.Context, event *auditModels.TimeTrackingDeletion) error {
	if event == nil {
		return fmt.Errorf("time tracking deletion audit event is required")
	}
	if err := event.Validate(); err != nil {
		return fmt.Errorf("invalid time tracking deletion audit event: %w", err)
	}
	return NewAppender(r.runtime, r.now).Append(ctx, event)
}
