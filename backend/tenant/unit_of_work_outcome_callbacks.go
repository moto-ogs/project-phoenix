package tenant

import (
	"context"
	"sync"
)

type unitOfWorkOutcomeCallbacksKey struct{}

type unitOfWorkOutcomeCallbacks struct {
	mu sync.Mutex
	// callbacks holds callbacks by sequence so registering one does not replace
	// a callback while the unit of work is running.
	callbacks sync.Map
	next      uint64
	// handlerReturned is set when the handler returns inside the transaction;
	// the first transaction to finish after it is that transaction.
	handlerReturned, decided bool
	outcome                  UnitOfWorkResult
}

func (c *unitOfWorkOutcomeCallbacks) add(callback func(context.Context, UnitOfWorkResult)) {
	c.mu.Lock()
	c.next++
	c.callbacks.Store(c.next, callback)
	c.mu.Unlock()
}

func (c *unitOfWorkOutcomeCallbacks) observe(event UnitOfWorkEvent) {
	if event.Kind != UnitOfWorkTransaction {
		return
	}
	c.mu.Lock()
	if c.handlerReturned && !c.decided {
		c.outcome, c.decided = event.Result, true
	}
	c.mu.Unlock()
}

// WithUnitOfWorkOutcomeCallbacks prepares ctx before its transaction opens.
// MarkUnitOfWorkHandlerReturned marks that the handler returned within that
// transaction; settle then calls every registered callback after the first
// transaction that ends following the return.
func WithUnitOfWorkOutcomeCallbacks(ctx context.Context) (prepared context.Context, settle func(context.Context)) {
	callbacks := &unitOfWorkOutcomeCallbacks{}
	prepared = context.WithValue(WithAdditionalUnitOfWorkObserver(ctx, callbacks.observe), unitOfWorkOutcomeCallbacksKey{}, callbacks)
	return prepared, func(ctx context.Context) {
		callbacks.mu.Lock()
		outcome := callbacks.outcome
		callbacks.mu.Unlock()
		if outcome == UnitOfWorkCommitted {
			return
		}
		callbacks.callbacks.Range(func(key, value any) bool {
			callbacks.callbacks.Delete(key)
			value.(func(context.Context, UnitOfWorkResult))(ctx, outcome)
			return true
		})
	}
}

// RegisterUnitOfWorkOutcomeCallback adds a callback for work that committed
// before the surrounding transaction's outcome is known.
func RegisterUnitOfWorkOutcomeCallback(ctx context.Context, callback func(context.Context, UnitOfWorkResult)) {
	if callbacks, ok := ctx.Value(unitOfWorkOutcomeCallbacksKey{}).(*unitOfWorkOutcomeCallbacks); ok && callback != nil {
		callbacks.add(callback)
	}
}

// MarkUnitOfWorkHandlerReturned marks the return from the handler inside a
// transaction prepared with WithUnitOfWorkOutcomeCallbacks.
func MarkUnitOfWorkHandlerReturned(ctx context.Context) {
	if callbacks, ok := ctx.Value(unitOfWorkOutcomeCallbacksKey{}).(*unitOfWorkOutcomeCallbacks); ok {
		callbacks.mu.Lock()
		callbacks.handlerReturned = true
		callbacks.mu.Unlock()
	}
}
