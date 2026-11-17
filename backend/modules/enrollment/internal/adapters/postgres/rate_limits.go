package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/uptrace/bun"
)

// Store implements per-IP / per-email rate
// limiting for the public enrollment submit endpoint. The single
// upsert query is atomic, so a burst of concurrent requests for the
// same key cannot oversubscribe the bucket.
type Store struct {
	resolve  func(context.Context) (bun.IDB, error)
	tenantID func(context.Context) (int64, error)
	// now stamps the rows the store writes (updated_at, reviewed_at,
	// late-invite creation). Only WithClock sets it; a store without it
	// serves reads.
	now func() time.Time
}

func NewStore(resolve func(context.Context) (bun.IDB, error), tenantID func(context.Context) (int64, error)) *Store {
	return &Store{resolve: resolve, tenantID: tenantID}
}

// WithClock returns the store stamping its writes with now (ADR 0239); a
// nil clock is a wiring error.
func (r *Store) WithClock(now func() time.Time) *Store {
	if now == nil {
		panic("enrollment store: the clock is required")
	}
	clocked := *r
	clocked.now = now
	return &clocked
}

// currentTime is the instant the store stamps a write with. A write through
// a store built without WithClock is a wiring error (ADR 0275).
func (r *Store) currentTime() time.Time {
	if r.now == nil {
		panic("enrollment store: a write needs the clock of WithClock")
	}
	return r.now()
}

// IncrementAttempts mirrors auth.PasswordResetRateLimitRepository.IncrementAttempts
// but adds tenant scope and a caller-provided window length. The query
// is a single SQL statement so the read-modify-write is atomic at the
// row level.
func (r *Store) IncrementAttempts(ctx context.Context, tenantID int64, keyType, keyValue string, window time.Duration) (*enrollment.SubmissionRateLimitState, error) {
	type result struct {
		Attempts int `bun:"attempts"`
	}

	windowSeconds := int64(window.Seconds())
	if windowSeconds <= 0 {
		return nil, fmt.Errorf("invalid rate-limit window: %s", window)
	}

	db, err := r.resolve(ctx)
	if err != nil {
		return nil, err
	}
	type bucket struct {
		bun.BaseModel `bun:"table:enrollment.submission_rate_limits,alias:submission_rate_limits"`
		TenantID      int64     `bun:"tenant_id"`
		KeyType       string    `bun:"key_type"`
		KeyValue      string    `bun:"key_value"`
		Attempts      int       `bun:"attempts"`
		WindowStart   time.Time `bun:"window_start"`
		UpdatedAt     time.Time `bun:"updated_at"`
	}
	now := r.currentTime()
	windowStart := now.Add(-time.Duration(windowSeconds) * time.Second)
	row := bucket{TenantID: tenantID, KeyType: keyType, KeyValue: keyValue, Attempts: 1, WindowStart: now, UpdatedAt: now}
	var state result
	err = db.NewInsert().Model(&row).
		On("CONFLICT (tenant_id, key_type, key_value) DO UPDATE").
		Set("attempts = CASE WHEN submission_rate_limits.window_start > ? THEN submission_rate_limits.attempts + 1 ELSE 1 END", windowStart).
		Set("window_start = CASE WHEN submission_rate_limits.window_start > ? THEN submission_rate_limits.window_start ELSE EXCLUDED.window_start END", windowStart).
		Set("updated_at = EXCLUDED.updated_at").
		Returning("attempts").
		Scan(ctx, &state)
	if err != nil {
		return nil, fmt.Errorf("increment enrollment submission rate limit: %w", err)
	}
	return &enrollment.SubmissionRateLimitState{Attempts: state.Attempts}, nil
}

// CleanupExpired removes the school's rows whose window_start is older than
// olderThan, the longest submission window, so no running window loses its
// count.
// The nightly retention of the school in context calls it (#4046).
func (r *Store) CleanupExpired(ctx context.Context, olderThan time.Duration) (int, error) {
	seconds, err := positiveSeconds(olderThan)
	if err != nil {
		return 0, err
	}
	db, err := r.resolve(ctx)
	if err != nil {
		return 0, err
	}
	tenantID, err := r.tenantID(ctx)
	if err != nil {
		return 0, fmt.Errorf("cleanup enrollment submission rate limits: tenant is required: %w", err)
	}
	res, err := db.NewDelete().
		Table("enrollment.submission_rate_limits").
		Where("tenant_id = ?", tenantID).
		Where("window_start < ?", r.currentTime().Add(-time.Duration(seconds)*time.Second)).
		Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("cleanup enrollment submission rate limits: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("cleanup enrollment submission rate limits: rows affected: %w", err)
	}
	return int(affected), nil
}

// positiveSeconds converts a rate-limit retention to the whole seconds the
// queries bind.
func positiveSeconds(d time.Duration) (int64, error) {
	seconds := int64(d.Seconds())
	if seconds <= 0 {
		return 0, fmt.Errorf("enrollment postgres: invalid rate-limit retention %s", d)
	}
	return seconds, nil
}
