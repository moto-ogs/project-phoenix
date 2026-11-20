package timetablehttp

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTimetableResourceRejectsMissingSettings(t *testing.T) {
	t.Parallel()
	require.PanicsWithValue(t, "timetable API: settings service is required", func() {
		NewResource(Dependencies{})
	})
}
