package presenceprojectionhttp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type plannedActivityReader struct {
	activities map[int64][]StudentListPlannedActivity
	err        error
	asked      [][]int64
	days       []calendar.Date
}

func (r *plannedActivityReader) PlannedActivities(_ context.Context, ids []int64, day calendar.Date) (map[int64][]StudentListPlannedActivity, error) {
	r.asked = append(r.asked, ids)
	r.days = append(r.days, day)
	return r.activities, r.err
}

type cardActivitiesSetting struct {
	TenantSettings
	enabled bool
	err     error
}

func (s cardActivitiesSetting) ResolveBool(_ context.Context, key string) (bool, error) {
	if key != settingStudentCardActivitiesEnabled {
		return false, errors.New("unexpected setting " + key)
	}
	return s.enabled, s.err
}

// TestAttachPlannedActivities pins the "Alle Kinder" side of #8194: the
// offerings of the listed day reach the rows the caller fully reads, behind
// users:read and the school's setting.
func TestAttachPlannedActivities(t *testing.T) {
	t.Parallel()
	day := calendar.NewDate(2099, time.March, 2)
	reading := testpkg.WithPermissionsContext(context.Background(), []string{"users:read"})
	page := func() []SlimStudentResponse {
		return []SlimStudentResponse{{ID: 1, HasFullAccess: true}, {ID: 2, HasFullAccess: false}, {ID: 3, HasFullAccess: true}}
	}
	pottery := StudentListPlannedActivity{Title: "Töpfer-AG", StartTime: "14:00", EndTime: "15:00"}
	// The reader answers for every child, so the redaction below is the
	// projection's own doing.
	activities := map[int64][]StudentListPlannedActivity{1: {pottery}, 2: {pottery}}

	reader := &plannedActivityReader{activities: activities}
	rs := &Resource{ResourceConfig{PlannedActivities: reader, SettingsService: cardActivitiesSetting{enabled: true}}}
	rows := page()
	require.NoError(t, rs.attachPlannedActivities(reading, rows, day))
	assert.Equal(t, []StudentListPlannedActivity{pottery}, rows[0].PlannedActivities)
	assert.Empty(t, rows[1].PlannedActivities, "a redacted row carries no day plan")
	assert.Empty(t, rows[2].PlannedActivities)
	assert.Equal(t, [][]int64{{1, 3}}, reader.asked, "a redacted row is never asked for")
	assert.Equal(t, []calendar.Date{day}, reader.days)

	for name, call := range map[string]struct {
		ctx     context.Context
		enabled bool
	}{
		"without users:read": {testpkg.WithPermissionsContext(context.Background(), []string{"students:read"}), true},
		"switched off":       {reading, false},
	} {
		reader := &plannedActivityReader{activities: activities}
		rs := &Resource{ResourceConfig{PlannedActivities: reader, SettingsService: cardActivitiesSetting{enabled: call.enabled}}}
		rows := page()
		require.NoError(t, rs.attachPlannedActivities(call.ctx, rows, day), name)
		for _, row := range rows {
			assert.Empty(t, row.PlannedActivities, name)
		}
		assert.Empty(t, reader.asked, name)
	}

	failure := errors.New("timetable unavailable")
	rs = &Resource{ResourceConfig{PlannedActivities: &plannedActivityReader{err: failure}, SettingsService: cardActivitiesSetting{enabled: true}}}
	require.ErrorIs(t, rs.attachPlannedActivities(reading, page(), day), failure)

	settingFailure := errors.New("settings unavailable")
	rs = &Resource{ResourceConfig{PlannedActivities: &plannedActivityReader{}, SettingsService: cardActivitiesSetting{err: settingFailure}}}
	require.ErrorIs(t, rs.attachPlannedActivities(reading, page(), day), settingFailure)

	rs = &Resource{ResourceConfig{}}
	require.NoError(t, rs.attachPlannedActivities(reading, page(), day), "without the reader no offering is attached")
}
