package presenceprojectionhttp

import (
	"net/http/httptest"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// statusDayRangeToday is any day: every case names both bounds.
var statusDayRangeToday = calendar.NewDate(2026, 5, 27)

func TestStatusDayRangeParsing(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest("GET", "/status-days?from=2026-05-25&to=2026-05-29", nil)

	from, to, err := parseStatusDayRangeAt(req, statusDayRangeToday)
	require.NoError(t, err)
	assert.Equal(t, "2026-05-25", from.Format(dateFormatYYYYMMDD))
	assert.Equal(t, "2026-05-29", to.Format(dateFormatYYYYMMDD))

	_, _, err = parseStatusDayRangeAt(httptest.NewRequest("GET", "/status-days?from=broken&to=2026-05-29", nil), statusDayRangeToday)
	require.ErrorContains(t, err, "invalid from date format")

	_, _, err = parseStatusDayRangeAt(httptest.NewRequest("GET", "/status-days?from=2026-05-25&to=broken", nil), statusDayRangeToday)
	require.ErrorContains(t, err, "invalid to date format")

	_, _, err = parseStatusDayRangeAt(httptest.NewRequest("GET", "/status-days?from=2026-05-29&to=2026-05-25", nil), statusDayRangeToday)
	require.ErrorContains(t, err, "to must be after from")
}

const dateFormatYYYYMMDD = "2006-01-02"
