package compose

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	"github.com/moto-ogs/project-phoenix/modules/communication/internal/adapters/parentpostgres"
	"github.com/moto-ogs/project-phoenix/modules/communication/internal/application"
	parentMessages "github.com/moto-ogs/project-phoenix/modules/communication/internal/parentmessages"
	"github.com/uptrace/bun"
)

// ParentMessageRetentionSettings resolves the school's retention window.
type ParentMessageRetentionSettings interface {
	ParentMessageRetentionDays(context.Context) (int, error)
}

// NewParentMessageRetention composes the nightly deletion of expired parent
// messages (#3959) over the ambient tenant transaction of db.
func NewParentMessageRetention(db *bun.DB, settings ParentMessageRetentionSettings, now func() time.Time) communication.ParentMessageCleanup {
	return application.NewParentMessageRetention(parentMessages.Retention{
		Store:    parentpostgres.NewRetentionStore(parentDatabase(db)),
		Settings: settings, Now: now,
	})
}
