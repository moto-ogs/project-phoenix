package messaging

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type retentionWindow struct {
	days int
	err  error
}

func (w retentionWindow) ParentMessageRetentionDays(context.Context) (int, error) {
	return w.days, w.err
}

type recordingRetentionStore struct {
	retentionDays int
	calls         int
}

func (s *recordingRetentionStore) DeleteMessagesBefore(_ context.Context, retentionDays int) (int64, int64, error) {
	s.calls++
	s.retentionDays = retentionDays
	return 4, 1, nil
}

func TestParentMessageRetentionDeletesBeforeTheRecordedWindow(t *testing.T) {
	t.Parallel()
	store := &recordingRetentionStore{}

	result, err := Retention{Store: store, Settings: retentionWindow{days: 365}}.
		CleanupExpiredMessages(context.Background())

	require.NoError(t, err)
	assert.Equal(t, RetentionResult{MessagesDeleted: 4, ThreadsDeleted: 1, RetentionDays: 365}, result)
	// The store counts the recorded window on the database clock (ADR 0277).
	assert.Equal(t, 365, store.retentionDays)
}

func TestParentMessageRetentionNeverDeletesOnAnUnknownWindow(t *testing.T) {
	t.Parallel()

	for name, window := range map[string]retentionWindow{
		"unreadable":   {err: errors.New("settings unavailable")},
		"not positive": {days: 0},
	} {
		store := &recordingRetentionStore{}
		_, err := Retention{Store: store, Settings: window}.CleanupExpiredMessages(context.Background())

		require.ErrorIs(t, err, ErrRetentionUnresolved, name)
		assert.Zero(t, store.calls, "%s: nothing is deleted on a guessed window", name)
	}
}
