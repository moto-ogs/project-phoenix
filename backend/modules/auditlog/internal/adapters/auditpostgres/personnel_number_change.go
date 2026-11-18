package audit

import (
	"context"
	"fmt"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

type PersonnelNumberChangeRepository struct {
	runtime Runtime
	now     func() time.Time
}

func NewPersonnelNumberChangeRepository(runtime Runtime, now func() time.Time) auditModels.PersonnelNumberChangeCreator {
	return &PersonnelNumberChangeRepository{runtime: requireRuntime(runtime), now: now}
}

func (r *PersonnelNumberChangeRepository) Create(ctx context.Context, event *auditModels.PersonnelNumberChange) error {
	if event == nil {
		return fmt.Errorf("personnel number change audit event is required")
	}
	if err := event.Validate(); err != nil {
		return fmt.Errorf("invalid personnel number change audit event: %w", err)
	}
	return NewAppender(r.runtime, r.now).Append(ctx, event)
}
