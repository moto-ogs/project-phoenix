package api

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

func TestNeighbourDemoCheckinsFollowTheBookedWindow(t *testing.T) {
	t.Parallel()
	thursday := calendar.NewDate(2026, time.November, 19).BerlinMidnight()
	short := neighbourCheckin{offering: neighbourOffering("Kurzbetreuung", 10, "14:00", demoWeekdays[:4])}
	full := neighbourCheckin{offering: neighbourOffering("Ganztag", 24, "16:30", demoWeekdays)}

	assert.False(t, short.due(thursday.Add(12*time.Hour+29*time.Minute)))
	assert.True(t, short.due(thursday.Add(12*time.Hour+30*time.Minute).UTC()))
	assert.False(t, short.due(thursday.Add(14*time.Hour)))
	assert.False(t, short.due(thursday.AddDate(0, 0, 1).Add(13*time.Hour)))
	assert.True(t, full.due(thursday.AddDate(0, 0, 1).Add(13*time.Hour)))
	assert.False(t, full.due(thursday.AddDate(0, 0, 2).Add(13*time.Hour)))
}
