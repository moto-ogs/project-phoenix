//go:build testhooks

package api

import (
	"time"

	facilitiesModule "github.com/moto-ogs/project-phoenix/modules/facilities"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
)

// NewRoomClosuresForTest composes the room closures (#7653) the way the
// root does, on the test's clock when it passes one.
func NewRoomClosuresForTest(db transactionruntime.Database, clocks ...func() time.Time) facilitiesModule.Closures {
	closures, err := owners.BuildRoomClosures(db, OptionalClock(clocks))
	if err != nil {
		panic(err)
	}
	return closures
}
