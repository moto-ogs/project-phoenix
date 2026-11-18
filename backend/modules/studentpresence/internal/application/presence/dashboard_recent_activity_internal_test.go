package presence

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
	"github.com/stretchr/testify/assert"
)

// The recent activity measures a session's age on the service clock that
// stamped its start (#7104): with the clock years from the real day, a
// session started five minutes ago is recent and one started two hours ago
// is not.
func TestRecentActivityMeasuresOnTheServiceClock(t *testing.T) {
	t.Parallel()
	for _, now := range []time.Time{
		time.Date(2019, time.February, 4, 9, 0, 0, 0, time.UTC),
		time.Date(2040, time.March, 14, 11, 0, 0, 0, time.UTC),
	} {
		fresh := &ports.ActiveGroup{ID: 100, RoomID: 10, StartTime: now.Add(-5 * time.Minute)}
		stale := &ports.ActiveGroup{ID: 200, RoomID: 20, StartTime: now.Add(-2 * time.Hour)}
		rooms := &dashboardRoomData{roomByID: map[int64]*studentpresence.SessionRoom{}, roomStudentsMap: map[int64]map[int64]struct{}{}}

		recent := buildRecentActivity([]*ports.ActiveGroup{fresh, stale}, map[int64]*ports.SessionActivity{}, rooms, now)

		if assert.Len(t, recent, 1, now.String()) {
			assert.Equal(t, fresh.StartTime, recent[0].Timestamp, now.String())
		}
	}
}
