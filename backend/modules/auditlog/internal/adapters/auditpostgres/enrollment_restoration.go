package audit

import (
	"context"
	"fmt"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

type EnrollmentRestorationRepository struct {
	runtime Runtime
	now     func() time.Time
}

func NewEnrollmentRestorationRepository(runtime Runtime, now func() time.Time) auditModels.EnrollmentRestorationRepository {
	return &EnrollmentRestorationRepository{runtime: requireRuntime(runtime), now: now}
}

func (r *EnrollmentRestorationRepository) Create(ctx context.Context, event *auditModels.EnrollmentRestoration) error {
	if event == nil {
		return fmt.Errorf("enrollment restoration audit event is required")
	}
	return NewAppender(r.runtime, r.now).Append(ctx, event)
}
