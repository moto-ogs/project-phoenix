package enrollment

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A service period may run two years from its start and end at most five
// years after the school's today (#5658). An end exactly on a bound passes.

func TestValidateServicePeriodBounds(t *testing.T) {
	t.Parallel()

	today := calendar.NewDate(2026, 11, 18)
	cases := []struct {
		name       string
		start, end Date
		code       string
	}{
		{"school year", "2026-08-01", "2027-07-31", ""},
		{"exactly two years", "2026-08-01", "2028-08-01", ""},
		{"one day over two years", "2026-08-01", "2028-08-02", CodePhaseServicePeriodTooLong},
		{"far beyond two years", "2026-08-01", "5000-07-31", CodePhaseServicePeriodTooLong},
		{"end exactly five years ahead", "2029-11-18", "2031-11-18", ""},
		{"end one day over five years", "2029-11-19", "2031-11-19", CodePhaseServiceEndTooFar},
		{"leap day start", "2028-02-29", "2030-03-01", ""},
		{"leap day start one day over", "2028-02-29", "2030-03-02", CodePhaseServicePeriodTooLong},
		{"past period", "2020-08-01", "2021-07-31", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateServicePeriodBounds(tc.start, tc.end, today)
			if tc.code == "" {
				require.NoError(t, err)
				return
			}
			requireRejection(t, err, tc.code, "service_end_date")
		})
	}
}

func TestValidateServicePeriodBounds_RejectsMalformedDates(t *testing.T) {
	t.Parallel()

	today := calendar.NewDate(2026, 11, 18)
	requireRejection(t, ValidateServicePeriodBounds("2026-13-01", "2027-07-31", today), CodePhaseServicePeriodInvalid, "service_start_date")
	requireRejection(t, ValidateServicePeriodBounds("2026-08-01", "", today), CodePhaseServicePeriodInvalid, "service_end_date")
}

// Phase.Validate runs on every stored write, including an update that keeps
// the period, so a stored phase beyond the bounds must still pass it.
func TestPhaseValidate_KeepsPeriodsBeyondTheBounds(t *testing.T) {
	t.Parallel()

	p := validPhase()
	p.ServiceStartDate = "2026-08-01"
	p.ServiceEndDate = "5000-07-31"
	require.NoError(t, p.Validate())
}

func TestServicePeriodChanged(t *testing.T) {
	t.Parallel()

	assert.False(t, ServicePeriodChanged("2026-08-01", "2030-07-31", "2026-08-01", "2030-07-31"))
	assert.True(t, ServicePeriodChanged("2026-08-01", "2030-07-31", "2026-08-02", "2030-07-31"))
	assert.True(t, ServicePeriodChanged("2026-08-01", "2030-07-31", "2026-08-01", "2030-07-30"))
}
