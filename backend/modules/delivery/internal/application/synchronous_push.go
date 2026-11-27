package application

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/domain"
)

type targetedPushStore interface {
	ClaimPush(context.Context, int64, int64, time.Time, time.Time) (domain.Intent, bool, error)
}

// DispatchPush uses the worker's store and provider. Only the requested entry
// is claimed. A concurrent holder is observed until its result is available.
func (w *Worker) DispatchPush(ctx context.Context, tenantID, id int64) error {
	store, ok := w.store.(targetedPushStore)
	if !ok {
		return errors.New("delivery: targeted push store is not configured")
	}
	for {
		now := w.now()
		intent, acquired, err := store.ClaimPush(ctx, tenantID, id, now, now.Add(w.leaseDuration))
		if err != nil {
			return err
		}
		switch domain.State(intent.Status) {
		case domain.StateSent:
			return nil
		case domain.StateDeadLetter:
			if intent.LastError != nil {
				return errors.New(*intent.LastError)
			}
			return errors.New("delivery: push previously failed")
		case domain.StateCancelled:
			return domain.ErrCancelled
		}
		if acquired {
			return w.deliverPushOnce(ctx, intent)
		}
		timer := time.NewTimer(25 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (w *Worker) deliverPushOnce(ctx context.Context, intent domain.Intent) error {
	token, active, err := w.store.StartDelivery(ctx, intent.Transport, intent.ID, leaseToken(intent), synchronousDispatchLease(ctx, w.now(), w.leaseDuration))
	if err != nil {
		return err
	}
	if !active {
		return errors.New("delivery: push lease was lost before dispatch")
	}
	result, sendErr := w.provider.Send(ctx, intent)
	// Finalization must survive request cancellation: otherwise a reported
	// transport failure could remain recoverable and be sent by the worker.
	finalizeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), providerTimeout)
	defer cancel()
	if errors.Is(sendErr, domain.ErrCancelled) {
		done, err := w.store.FinalizeCancelled(finalizeCtx, intent.Transport, intent.ID, token, sendErr.Error(), w.now())
		if err == nil && !done {
			err = errors.New("delivery: cancelled push lost its lease")
		}
		return errors.Join(sendErr, err)
	}
	if errors.Is(sendErr, domain.ErrDeferred) {
		done, err := w.store.FinalizeDeferred(finalizeCtx, intent.Transport, intent.ID, token, sendErr.Error(), w.now().Add(retryBackoff[0]))
		if err == nil && !done {
			err = errors.New("delivery: deferred push lost its lease")
		}
		return err
	}
	if sendErr != nil {
		result, err := w.store.FinalizeFailure(finalizeCtx, intent.Transport, intent.ID, token, intent.Attempts+1, sendErr.Error(), w.now(), 1)
		if err == nil && !result.Finalized {
			err = errors.New("delivery: failed push lost its lease")
		}
		return errors.Join(sendErr, err)
	}
	return w.finalizeSynchronousSend(finalizeCtx, intent, token, result)
}
