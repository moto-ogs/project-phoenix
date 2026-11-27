package compose

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	applicationBindings "github.com/moto-ogs/project-phoenix/modules/facilities/internal/application"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
)

// NewUnobserved composes the room owner for CLI roots and tests that record no observations; production roots use New so runtime evidence is kept and deletions are validated.
func NewUnobserved(db *bun.DB) (facilities.Capability, error) {
	return New(Dependencies{
		DB: db, DeletionLock: func(context.Context) error { return nil }, Observe: func(Observation) {},
		// The legacy repository accepted deletes without service-level guards; graphs without the API root keep that path usable.
		Usage: applicationBindings.UnusedRooms{}, References: applicationBindings.NoRoomReferences,
	})
}

// NewNoticedClosures tells the staff planned in the room of a new closure (#8234).
func NewNoticedClosures(closures facilities.Closures, notices facilities.ClosureNotices, today func() calendar.Date) facilities.Closures {
	return applicationBindings.NewNoticedClosures(closures, notices, transaction{}, today)
}
