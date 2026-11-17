package audit

import (
	"context"
	"time"

	auditModels "github.com/moto-ogs/project-phoenix/modules/auditlog/records"
)

type substitutionChangeRepository struct {
	runtime Runtime
	now     func() time.Time
}

func NewSubstitutionChangeRepository(runtime Runtime, now func() time.Time) auditModels.SubstitutionChangeCreator {
	return &substitutionChangeRepository{runtime: requireRuntime(runtime), now: now}
}

func (r *substitutionChangeRepository) Create(ctx context.Context, change *auditModels.SubstitutionChange) error {
	return NewAppender(r.runtime, r.now).Append(ctx, change)
}
