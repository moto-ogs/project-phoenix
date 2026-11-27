package tenant

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestUnitOfWorkOutcomeCallbacksFollowTheTransaction(t *testing.T) {
	t.Parallel()
	finished := func(result UnitOfWorkResult) UnitOfWorkEvent {
		return UnitOfWorkEvent{Kind: UnitOfWorkTransaction, Result: result}
	}
	run := func(events ...UnitOfWorkEvent) []UnitOfWorkResult {
		var outcomes []UnitOfWorkResult
		ctx, settle := WithUnitOfWorkOutcomeCallbacks(t.Context())
		callbacks := ctx.Value(unitOfWorkOutcomeCallbacksKey{}).(*unitOfWorkOutcomeCallbacks)
		RegisterUnitOfWorkOutcomeCallback(ctx, func(_ context.Context, outcome UnitOfWorkResult) {
			outcomes = append(outcomes, outcome)
		})
		// A separately committed unit finishes while the handler runs.
		callbacks.observe(finished(UnitOfWorkCommitted))
		MarkUnitOfWorkHandlerReturned(ctx)
		for _, event := range events {
			callbacks.observe(event)
		}
		settle(t.Context())
		settle(t.Context())
		return outcomes
	}

	assert.Empty(t, run(finished(UnitOfWorkCommitted), finished(UnitOfWorkRolledBack)),
		"a committed transaction keeps the callbacks, whatever an after-commit hook's transaction does")
	assert.Equal(t, []UnitOfWorkResult{UnitOfWorkRolledBack}, run(finished(UnitOfWorkRolledBack), finished(UnitOfWorkCommitted)),
		"a transaction that rolls back calls back once")
	assert.Equal(t, []UnitOfWorkResult{UnitOfWorkCommitUnknown}, run(finished(UnitOfWorkCommitUnknown)),
		"a commit of unknown outcome reaches the callback")
	assert.Equal(t, []UnitOfWorkResult{UnitOfWorkResult("")}, run(),
		"a transaction that never reported a commit calls back")
}
