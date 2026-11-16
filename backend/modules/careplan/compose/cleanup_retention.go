package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/adapters/postgres"
)

// NewCleanupRetention composes the Care Plan retention of finished records in the nightly cleanup (#4046) on now, the root's clock, in the tenant transaction of the school in context.
func NewCleanupRetention(now func() time.Time) careplan.CleanupRetention {
	return postgres.CleanupRetention{Store: postgres.New(postgres.RetentionDatabase).WithClock(now)}
}
