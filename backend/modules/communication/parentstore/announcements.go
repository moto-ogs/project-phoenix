package parentstore

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication/internal/adapters/parentpostgres"
	recordports "github.com/moto-ogs/project-phoenix/modules/communication/ports"
	"github.com/uptrace/bun"
)

func NewParentAnnouncementRepository(db *bun.DB, audience recordports.AnnouncementAudienceReads, now func() time.Time) recordports.ParentAnnouncementRepository {
	return parentpostgres.NewParentAnnouncementRepository(db, audience, now)
}
