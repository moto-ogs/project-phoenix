package api

import (
	"context"
	"errors"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/schoolsetup"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	workforceModule "github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type schoolSetupModuleSwitch struct {
	booked bool
	err    error
	key    string
}

func (s *schoolSetupModuleSwitch) ResolveBool(_ context.Context, key string) (bool, error) {
	s.key = key
	return s.booked, s.err
}

type schoolSetupCoverageCount struct {
	coverage    workforceModule.TargetCoverage
	err         error
	calls       int
	year, month int
}

func (c *schoolSetupCoverageCount) TargetCoverage(_ context.Context, year, month int) (*workforceModule.TargetCoverage, error) {
	c.calls++
	c.year, c.month = year, month
	if c.err != nil {
		return nil, c.err
	}
	return &c.coverage, nil
}

// TestSchoolSetupWorkTimeBinding pins the binding of the working-time step
// (#6919): the module switch decides whether the step exists, and the count
// is the payroll check's own (year and month zero, #6890).
func TestSchoolSetupWorkTimeBinding(t *testing.T) {
	t.Parallel()
	failure := errors.New("unavailable")

	t.Run("without Zeiterfassung nothing is counted", func(t *testing.T) {
		t.Parallel()
		settings, coverage := &schoolSetupModuleSwitch{}, &schoolSetupCoverageCount{}
		targets, err := newSchoolSetupWorkTime(settings, coverage)(context.Background())
		require.NoError(t, err)
		assert.Equal(t, schoolsetup.WorkTimeTargets{}, targets)
		assert.Equal(t, configModels.KeyModuleZeiterfassung, settings.key)
		assert.Zero(t, coverage.calls)
	})

	t.Run("with Zeiterfassung the payroll month counts", func(t *testing.T) {
		t.Parallel()
		coverage := &schoolSetupCoverageCount{coverage: workforceModule.TargetCoverage{Year: 2026, Month: 9, StaffTotal: 5, StaffWithoutTarget: 2}}
		targets, err := newSchoolSetupWorkTime(&schoolSetupModuleSwitch{booked: true}, coverage)(context.Background())
		require.NoError(t, err)
		assert.Equal(t, schoolsetup.WorkTimeTargets{Booked: true, StaffTotal: 5, StaffWithoutTarget: 2}, targets)
		assert.Equal(t, [2]int{0, 0}, [2]int{coverage.year, coverage.month}, "year and month zero select the payroll month")
	})

	t.Run("failures surface", func(t *testing.T) {
		t.Parallel()
		_, err := newSchoolSetupWorkTime(&schoolSetupModuleSwitch{err: failure}, &schoolSetupCoverageCount{})(context.Background())
		require.ErrorIs(t, err, failure)
		_, err = newSchoolSetupWorkTime(&schoolSetupModuleSwitch{booked: true}, &schoolSetupCoverageCount{err: failure})(context.Background())
		require.ErrorIs(t, err, failure)
	})
}
