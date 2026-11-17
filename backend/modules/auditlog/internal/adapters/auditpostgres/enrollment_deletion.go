package audit

import (
	"context"
	"fmt"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

type EnrollmentDeletionRepository struct {
	runtime Runtime
	now     func() time.Time
}

func NewEnrollmentDeletionRepository(runtime Runtime, now func() time.Time) auditModels.EnrollmentDeletionRepository {
	return &EnrollmentDeletionRepository{runtime: requireRuntime(runtime), now: now}
}

func (r *EnrollmentDeletionRepository) Create(ctx context.Context, event *auditModels.EnrollmentDeletion) error {
	if event == nil {
		return fmt.Errorf("enrollment deletion audit event is required")
	}
	return NewAppender(r.runtime, r.now).Append(ctx, event)
}
