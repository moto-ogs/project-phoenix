package messaging

import (
	"context"
	"errors"
	"fmt"
)

// ErrRetentionUnresolved means the school's parent-message retention window
// could not be determined. The sweep fails for that school rather than
// deleting on a guess.
var ErrRetentionUnresolved = errors.New("messaging: parent message retention window could not be resolved")

// RetentionStore deletes the parent messages of the school in context that
// are older than retentionDays and the conversations they leave empty. It
// counts the window on the database clock, which stamps the messages and
// orders them (ADR 0277).
type RetentionStore interface {
	DeleteMessagesBefore(ctx context.Context, retentionDays int) (messages, threads int64, err error)
}

// RetentionSettings resolves the school's retention window.
type RetentionSettings interface {
	ParentMessageRetentionDays(ctx context.Context) (int, error)
}

// RetentionResult reports one school's retention sweep.
type RetentionResult struct {
	MessagesDeleted int
	ThreadsDeleted  int
	RetentionDays   int
}

// Retention ages out the parent/OGS messages of a school after the retention
// window the moto team recorded for it (#3959). Like the staff chat it runs
// whether or not messaging is switched on: a school that turned messaging off
// still has its old messages deleted.
type Retention struct {
	Store    RetentionStore
	Settings RetentionSettings
}

// CleanupExpiredMessages deletes the messages older than the window and the
// conversations left without any message.
func (r Retention) CleanupExpiredMessages(ctx context.Context) (RetentionResult, error) {
	if r.Store == nil || r.Settings == nil {
		return RetentionResult{}, ErrRetentionUnresolved
	}
	days, err := r.Settings.ParentMessageRetentionDays(ctx)
	if err != nil {
		return RetentionResult{}, fmt.Errorf("%w: %w", ErrRetentionUnresolved, err)
	}
	if days <= 0 {
		return RetentionResult{}, fmt.Errorf("%w: window must be positive, got %d", ErrRetentionUnresolved, days)
	}
	messages, threads, err := r.Store.DeleteMessagesBefore(ctx, days)
	if err != nil {
		return RetentionResult{RetentionDays: days}, err
	}
	return RetentionResult{MessagesDeleted: int(messages), ThreadsDeleted: int(threads), RetentionDays: days}, nil
}

func (r RetentionResult) CleanupCounts() (int, int, int) {
	return r.MessagesDeleted, r.ThreadsDeleted, r.RetentionDays
}
