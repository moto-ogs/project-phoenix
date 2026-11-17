package compose

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/application"
)

// The Workforce deletions of the nightly cleanup. Each runs on the tenant
// transaction of the school in context.

// NewRetiredStaffRecords erases a retired staff member's records (#3963).
func NewRetiredStaffRecords() workforce.RetiredStaffRecords {
	return postgres.New(postgres.RetentionDatabase)
}

// NewCleanupRetention composes the staff cleanup-job retention of the nightly
// cleanup (#4046) on now, the root's clock. It runs on the tenant transaction
// of the school in context and needs no object store.
func NewCleanupRetention(now func() time.Time) workforce.CleanupRetention {
	return application.NewCleanupRetention(postgres.New(postgres.RetentionDatabase).WithClock(now))
}

// SickNoteRetentionWindow resolves the staff sick note retention window of
// the school in context; the root binds it to the Settings Platform.
type SickNoteRetentionWindow interface {
	StaffSickNoteRetentionDays(ctx context.Context) (int, error)
}

// NewSickNoteRetention composes the sick note retention of the nightly
// cleanup (#3961) on the database clock, which stamps the upload and guards
// the cutoff (ADR 0281), in the school's tenant transaction.
func NewSickNoteRetention(window SickNoteRetentionWindow) workforce.SickNoteRetention {
	if window == nil {
		panic("workforce compose: sick note retention requires settings")
	}
	return application.NewSickNoteRetention(postgres.New(postgres.RetentionDatabase), window)
}
