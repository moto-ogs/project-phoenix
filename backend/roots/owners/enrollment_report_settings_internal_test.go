package owners

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestEnrollmentReportsRejectMissingSettings(t *testing.T) {
	t.Parallel()
	require.PanicsWithValue(t, "enrollment reports: settings resolver is required", func() {
		NewEnrollmentReports(EnrollmentReportSources{Now: time.Now})
	})
}
