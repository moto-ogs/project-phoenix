package compose

import (
	"context"
	"log/slog"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/adapters/postgres"
	"github.com/uptrace/bun"
)

func NewRequestRateLimits(db *bun.DB, fingerprint func(string) string, reservation func() (string, error), now func() time.Time, logger *slog.Logger) interface {
	Admit(context.Context, string, int, int, bool) (func(bool) error, error)
} {
	return postgres.NewRequestRateLimits(db, fingerprint, reservation, now, logger)
}
