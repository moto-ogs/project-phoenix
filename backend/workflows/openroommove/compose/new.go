// Package compose binds the open-room move workflow to the tenant runtime.
package compose

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/moto-ogs/project-phoenix/workflows/openroommove"
	"github.com/moto-ogs/project-phoenix/workflows/openroommove/internal/application"
	"github.com/moto-ogs/project-phoenix/workflows/openroommove/ports"
)

type Observation = ports.Observation

type Dependencies struct {
	Rooms        ports.Rooms
	RoomClosures ports.RoomClosures
	Activities   ports.Activities
	RoomSessions ports.RoomSessions
	Moves        ports.Moves
	Observe      func(Observation)
	// Today comes from the root's injected school clock.
	Today func() calendar.Date
}

func New(deps Dependencies) (openroommove.Command, error) {
	if deps.Rooms == nil || deps.RoomClosures == nil || deps.Activities == nil || deps.RoomSessions == nil || deps.Moves == nil || deps.Observe == nil || deps.Today == nil {
		return nil, errors.New("open room move compose: all dependencies are required")
	}
	return application.NewCommand(application.Dependencies{
		Rooms:        deps.Rooms,
		RoomClosures: deps.RoomClosures,
		Activities:   deps.Activities,
		RoomSessions: deps.RoomSessions,
		Moves:        deps.Moves,
		Runtime: ports.Runtime{
			TenantID:     tenant.FromContext,
			WithinTenant: tenant.WithinCurrentTenant,
			AcquireLock:  func(ctx context.Context, key string) error { return tenant.AcquireLock(ctx, key, false) },
			Today:        deps.Today,
		},
		Observe: deps.Observe,
	}), nil
}
