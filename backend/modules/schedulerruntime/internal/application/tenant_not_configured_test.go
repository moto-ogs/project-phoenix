package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/schedulerruntime/ports"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// codedRejection stands in for School Calendar's ErrFederalStateMissing,
// which the scheduler knows only by its registered code.
type codedRejection struct{ code string }

func (rejection codedRejection) Error() string     { return "federal state is not set" }
func (rejection codedRejection) ErrorCode() string { return rejection.code }

// levelCounter counts log records by level.
type levelCounter struct {
	mu     sync.Mutex
	counts map[slog.Level]int
}

func (counter *levelCounter) Enabled(context.Context, slog.Level) bool { return true }
func (counter *levelCounter) Handle(_ context.Context, record slog.Record) error {
	counter.mu.Lock()
	defer counter.mu.Unlock()
	counter.counts[record.Level]++
	return nil
}
func (counter *levelCounter) WithAttrs([]slog.Attr) slog.Handler { return counter }
func (counter *levelCounter) WithGroup(string) slog.Handler      { return counter }

func (counter *levelCounter) count(level slog.Level) int {
	counter.mu.Lock()
	defer counter.mu.Unlock()
	return counter.counts[level]
}

// A school without a federal state is skipped without failing the run (#7174
// removed the default state); other schools run and a real failure still
// fails the run.
func TestTenantBatchesSkipSchoolWithoutFederalState(t *testing.T) {
	t.Parallel()

	missingState := fmt.Errorf("load holidays: %w: unsupported region %q", codedRejection{code: codeFederalStateMissing}, "")
	commandErr := errors.New("owner command failed")
	logs := &levelCounter{counts: map[slog.Level]int{}}
	now := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	scheduler := newScheduler(ports.WorkerDependencies{
		Now:    func() time.Time { return now },
		Logger: slog.New(logs),
		TenantRuntime: scriptedTenantRuntime(func(ctx context.Context, _ int64, run func(context.Context, any) error) error {
			return run(ctx, struct{}{})
		}, func(error) bool { return false }),
	})
	var runOutcomes []string
	var failures []error
	scheduler.workerTracer.Run = func(_ ports.JobID, outcome string, _ time.Duration) { runOutcomes = append(runOutcomes, outcome) }
	scheduler.workerTracer.Failure = func(_ context.Context, _ string, _ string, err error) { failures = append(failures, err) }

	run := func(tenantIDs []int64, failing int64) (called []int64, result TenantBatchResult) {
		scheduler.runJobCheck(&ScheduledTask{Name: "meal-orders"}, func(ctx context.Context, _ *ScheduledTask) {
			result = scheduler.runTenantBatches(ctx, tenantIDs, "meal-orders", TenantCommandFunc(func(_ context.Context, tenantID int64) error {
				called = append(called, tenantID)
				switch tenantID {
				case 24:
					return missingState
				case failing:
					return commandErr
				}
				return nil
			}))
		})
		return called, result
	}

	called, result := run([]int64{24, 25}, 0)
	assert.Equal(t, []int64{24, 25}, called)
	require.Len(t, result.Outcomes, 2)
	assert.Equal(t, TenantOutcomeNotConfigured, result.Outcomes[0].Classification)
	assert.Equal(t, []int64{25}, result.CompletedTenantIDs(), "a skipped school has not completed the job")
	assert.Zero(t, result.Failed())
	require.NoError(t, result.Err)
	assert.Equal(t, []string{"completed"}, runOutcomes)
	assert.Empty(t, failures, "a missing federal state is no Sentry event")
	assert.Zero(t, logs.count(slog.LevelError))
	assert.Equal(t, 1, logs.count(slog.LevelWarn))

	run([]int64{24, 25}, 0)
	assert.Equal(t, 1, logs.count(slog.LevelWarn), "one warning per job, school and day")
	now = now.Add(24 * time.Hour)
	run([]int64{24, 25}, 0)
	assert.Equal(t, 2, logs.count(slog.LevelWarn), "the next day warns again")

	_, result = run([]int64{24, 25, 26}, 26)
	assert.Equal(t, []string{"completed", "completed", "completed", "failed"}, runOutcomes)
	require.Len(t, failures, 1)
	assert.ErrorIs(t, failures[0], commandErr)
	assert.NotErrorIs(t, failures[0], missingState, "the skipped school stays out of the failure")
	assert.Equal(t, 1, result.Failed())
	classifications := map[int64]TenantOutcomeClassification{}
	for _, outcome := range result.Outcomes {
		classifications[outcome.TenantID] = outcome.Classification
	}
	assert.Equal(t, map[int64]TenantOutcomeClassification{
		24: TenantOutcomeNotConfigured, 25: TenantOutcomeSuccess, 26: TenantOutcomeCommandFailure,
	}, classifications)
}
