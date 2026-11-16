package ports

import (
	"context"
	"time"

	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"
)

type commandObserverKey struct{}

func WithCommandObserver(ctx context.Context, observer func(importModels.CommandObservation)) context.Context {
	return context.WithValue(ctx, commandObserverKey{}, observer)
}

func observeCommand(ctx context.Context, owner, operation string, elapsed func() time.Duration, err *error) {
	if observer, ok := ctx.Value(commandObserverKey{}).(func(importModels.CommandObservation)); ok {
		observer(importModels.CommandObservation{Owner: owner, Operation: operation, Duration: elapsed(), Failed: *err != nil})
	}
}

// stopwatch starts the latency measurement of one owner command and returns
// its reading on the monotonic clock. It is a stopwatch, not a clock (ADR
// 0240): a deferred observeCommand reads the duration when the command ends.
func stopwatch() func() time.Duration {
	started := time.Now()
	return func() time.Duration { return time.Since(started) }
}

// ObserveCommand covers retained owner capabilities whose types have not yet
// moved into these ports (invitation and consent-history commands).
func ObserveCommand(ctx context.Context, owner, operation string, command func() error) (err error) {
	defer observeCommand(ctx, owner, operation, stopwatch(), &err)
	return command()
}
