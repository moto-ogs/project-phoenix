package compose

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/ports"
	identityPorts "github.com/moto-ogs/project-phoenix/modules/identityaccess/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

// NewDemoAccessExpiry composes the demo process's expiry (#3470) on that
// process's own connection; now is the clock the process injects.
func NewDemoAccessExpiry(db bun.IDB, now func() time.Time) (*identityaccess.DemoAccessExpiry, error) {
	if db == nil {
		return nil, errors.New("identity access compose: demo access expiry requires a database")
	}
	if now == nil {
		return nil, errors.New("identity access compose: demo access expiry requires a clock")
	}
	return identityaccess.NewDemoAccessExpiry(demoAccessExpiryEngine{db: db, now: now}), nil
}

func composeDemoAccess(store *postgres.Store, sessions ports.DemoSessions, deps *identityPorts.DemoDependencies, hasDatabase bool, now func() time.Time) (*identityaccess.DemoAccess, error) {
	return application.NewDemoAccessBinding(hasDatabase, sessions, deps, store, tenant.WithinAdmin, now)
}

// demoAccessExpiryEngine deletes demo accesses 14 days after their last use
// (#3470). A use extends the access, so an access past its end has not been
// used for its whole lifetime; deleting it removes the prospect's contact
// data. The schools left without any access go back to the caller, which
// hides them through their owner.
type demoAccessExpiryEngine struct {
	db  bun.IDB
	now func() time.Time
}

func (e demoAccessExpiryEngine) ExpireDemoAccesses(ctx context.Context) (int, []string, error) {
	return postgres.ExpireDemoAccessesBinding(ctx, e.db, e.now, tenant.WithAdminTx)
}
