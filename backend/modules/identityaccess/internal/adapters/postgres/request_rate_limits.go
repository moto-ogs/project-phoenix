package postgres

import (
	"context"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/uptrace/bun"
)

// RequestRateLimits manages installation-wide quotas. It uses the unscoped auth pool
// because public requests arrive before a school or account is known.
type RequestRateLimits struct {
	db          *bun.DB
	fingerprint func(string) string
	now         func() time.Time
	logger      *slog.Logger
	pruneAfter  atomic.Int64
}

func NewRequestRateLimits(db *bun.DB, fingerprint func(string) string, now func() time.Time, logger *slog.Logger) *RequestRateLimits {
	return &RequestRateLimits{db: db, fingerprint: fingerprint, now: now, logger: logger}
}

// Admit returns a settlement function after admission. A nil function means
// the request exceeded its quota. The caller settles reservations even when
// the request disconnects.
func (s *RequestRateLimits) Admit(ctx context.Context, key string, requestsPerMinute, burst int, reserve bool) (func(bool) error, error) {
	digest := s.fingerprint(key)
	s.prune(ctx)
	reservation, err := s.apply(ctx, digest, requestsPerMinute, burst, "", false, !reserve)
	if err != nil || reservation == "" {
		return nil, err
	}
	return func(spend bool) error {
		if !reserve {
			return nil
		}
		settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		_, err := s.apply(settleCtx, digest, requestsPerMinute, burst, reservation, true, spend)
		return err
	}, nil
}

func (s *RequestRateLimits) apply(ctx context.Context, key string, limit, burst int, reservation string, settle, spend bool) (string, error) {
	var admission string
	err := s.db.NewRaw(`SELECT auth.request_rate_limit(?, ?, ?, ?, ?, ?)`,
		key, limit, burst, reservation, settle, spend).Scan(ctx, &admission)
	if err != nil {
		return "", fmt.Errorf("apply shared request rate limit: %w", err)
	}
	return admission, nil
}

func (s *RequestRateLimits) prune(ctx context.Context) {
	now := s.now()
	next := s.pruneAfter.Load()
	if now.UnixNano() < next || !s.pruneAfter.CompareAndSwap(next, now.Add(time.Minute).UnixNano()) {
		return
	}
	// This bounded sweep skips rows in use by other requests.
	_, err := s.db.ExecContext(ctx, `SELECT auth.prune_request_rate_limits()`)
	if err != nil {
		s.logger.WarnContext(ctx, "prune expired request rate limits", "error", err.Error())
	}
}
