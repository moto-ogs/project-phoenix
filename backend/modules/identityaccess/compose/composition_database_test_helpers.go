//go:build testhooks

package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

func newStore(db *bun.DB) *postgres.Store             { return postgres.NewStore(db, time.Now) }
func newTransactionRunner() *tenant.TransactionRunner { return tenant.NewTransactionRunner() }
