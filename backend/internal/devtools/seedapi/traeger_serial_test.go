package api

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// overlapStep records how many runs of it are in flight at once.
type overlapStep struct {
	running, peak *atomic.Int32
	release       <-chan struct{}
}

func (overlapStep) Name() string { return "overlap" }

func (s overlapStep) Run(context.Context, *Runtime) error {
	now := s.running.Add(1)
	for {
		peak := s.peak.Load()
		if now <= peak || s.peak.CompareAndSwap(peak, now) {
			break
		}
	}
	<-s.release
	s.running.Add(-1)
	return nil
}

func runOverlapping(t *testing.T, organizations []int64, wantRunning int32) int32 {
	t.Helper()

	var running, peak atomic.Int32
	release := make(chan struct{})
	step := traegerSerialStep{Step: overlapStep{running: &running, peak: &peak, release: release}}
	var done sync.WaitGroup
	for _, organizationID := range organizations {
		done.Add(1)
		go func() {
			defer done.Done()
			_ = step.Run(context.Background(), &Runtime{Bootstrap: &bootstrapSeedState{OrganizationID: organizationID}})
		}()
	}
	assert.Eventually(t, func() bool { return running.Load() >= wantRunning }, time.Second, time.Millisecond,
		"independent runs must enter before any finishes")
	// Without the lock the waiting schools would enter here as well.
	assert.Never(t, func() bool { return running.Load() > wantRunning }, 50*time.Millisecond, time.Millisecond,
		"a school of the same Träger must not enter while another runs")
	close(release)
	done.Wait()
	return peak.Load()
}

// Three demo schools of one Demo-Träger seeded at once each read the Träger's
// monthly runs and contracts and then wrote them; in parallel two started the
// same monthly run (409 parent_billing.care_run_open, CI run 42445063072).
func TestTraegerStepsRunOneSchoolAtATimePerTraeger(t *testing.T) {
	t.Parallel()

	assert.Equal(t, int32(1), runOverlapping(t, []int64{9101, 9101, 9101}, 1), "schools of one Träger wait for each other")
	assert.Equal(t, int32(2), runOverlapping(t, []int64{9201, 9202}, 2), "different Träger do not wait")
}

func TestTraegerStepWaitEndsWithTheContext(t *testing.T) {
	t.Parallel()

	var running, peak atomic.Int32
	release := make(chan struct{})
	rt := &Runtime{Bootstrap: &bootstrapSeedState{OrganizationID: 9301}}
	holder := traegerSerialStep{Step: overlapStep{running: &running, peak: &peak, release: release}}
	held := make(chan error, 1)
	go func() { held <- holder.Run(context.Background(), rt) }()
	require.Eventually(t, func() bool { return running.Load() == 1 }, time.Second, time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	assert.ErrorIs(t, holder.Run(ctx, rt), context.Canceled)
	close(release)
	assert.NoError(t, <-held)
}

// countingStep counts its runs.
type countingStep struct{ runs *int }

func (countingStep) Name() string { return "counting" }

func (s countingStep) Run(context.Context, *Runtime) error {
	*s.runs++
	return nil
}

// A seed beside other seed processes also holds their shared lock for the
// step, and a lock it cannot get fails the step without running it (#6962).
func TestTraegerStepHoldsTheLockSharedWithOtherProcesses(t *testing.T) {
	t.Parallel()

	runs, held, released := 0, 0, 0
	rt := &Runtime{
		Bootstrap: &bootstrapSeedState{OrganizationID: 9401},
		TraegerLock: func(context.Context) (func(), error) {
			held++
			return func() { released++ }, nil
		},
	}
	step := traegerSerialStep{Step: countingStep{runs: &runs}}
	require.NoError(t, step.Run(context.Background(), rt))
	assert.Equal(t, []int{1, 1, 1}, []int{runs, held, released}, "runs, acquisitions, releases")

	rt.TraegerLock = func(context.Context) (func(), error) { return nil, context.DeadlineExceeded }
	assert.ErrorIs(t, step.Run(context.Background(), rt), context.DeadlineExceeded)
	assert.Equal(t, 1, runs, "the step must not run without the lock")
}

func TestEveryTraegerStepOfTheDemoWorkflowRunsSerially(t *testing.T) {
	t.Parallel()

	for _, options := range []SeedOptions{{}, {DeferHistory: true}, {DeferHistory: true, OwnTraeger: true}} {
		seeder := &Seeder{options: options}
		steps := append(fullDemoWorkflow(seeder).Steps, deferredDemoSteps(seeder)...)
		traeger := 0
		for _, step := range steps {
			if !strings.Contains(step.Name(), "Träger") {
				continue
			}
			traeger++
			_, serial := step.(traegerSerialStep)
			assert.True(t, serial, "step %q writes Träger-wide state and must run serially", step.Name())
		}
		assert.Positive(t, traeger)
	}
}
