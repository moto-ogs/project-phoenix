//go:build testhooks

package compose

import (
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/application/repositoryadapter"
	"github.com/uptrace/bun"
)

func databaseRuntime(db *bun.DB) postgres.Database { return postgres.DatabaseRuntime(db) }

// NewRoomRepository serves the retained writable room fixture contract.
var NewRoomRepository = repositoryadapter.New
