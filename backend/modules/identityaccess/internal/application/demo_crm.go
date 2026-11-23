package application

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/ports"
)

type DemoCRMWorker struct {
	Store    ports.DemoCRMJobs
	Provider ports.DemoCRMProvider
	Execute  ports.DemoAdminTx
	Now      func() time.Time
}

func (w *DemoCRMWorker) RunOnce(ctx context.Context, limit, maxAttempts int) (int, error) {
	if limit < 1 || maxAttempts < 1 {
		return 0, errors.New("demo CRM: positive batch and retry budget required")
	}
	ctx = context.WithValue(ctx, standaloneAdminScopeKey{}, true)
	processed := 0
	for range limit {
		job, found, allowed, err := w.claim(ctx)
		if err != nil || !found {
			return processed, err
		}
		var sendErr error
		if allowed {
			sendErr = w.Provider.Sync(ctx, job.Contact)
		}
		next, terminal := demoCRMRetryPlan(w.Now(), job.Attempts, maxAttempts, allowed, sendErr)
		if err := w.Execute(ctx, func(tx context.Context) error { return w.Store.FinishDemoCRM(tx, job, next, terminal) }); err != nil {
			return processed, err
		}
		processed++
		if sendErr != nil && terminal {
			return processed, errors.New("demo CRM: delivery exhausted or rejected; payload erased")
		}
	}
	return processed, nil
}

func (w *DemoCRMWorker) claim(ctx context.Context) (job domain.DemoCRMJob, found, allowed bool, err error) {
	err = w.Execute(ctx, func(tx context.Context) error {
		var e error
		job, found, e = w.Store.ClaimDemoCRM(tx, w.Now())
		if e != nil || !found {
			return e
		}
		allowed, e = w.Store.DemoCRMAuthorized(tx, job, w.Now())
		return e
	})
	return
}

func demoCRMRetryPlan(now time.Time, attempt, maxAttempts int, allowed bool, sendErr error) (time.Time, bool) {
	terminal := !allowed || sendErr == nil || attempt >= maxAttempts
	var response interface{ Retryable() bool }
	if errors.As(sendErr, &response) && !response.Retryable() {
		terminal = true
	}
	next := now.Add(time.Minute * time.Duration(1<<min(attempt, 10)))
	var throttled interface{ RetryDelay(time.Time) time.Duration }
	if errors.As(sendErr, &throttled) {
		if delay := throttled.RetryDelay(now); delay > 0 {
			next = now.Add(max(time.Minute, delay))
		}
	}
	return next, terminal
}
