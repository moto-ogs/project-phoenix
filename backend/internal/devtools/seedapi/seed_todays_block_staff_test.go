package api

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Today gets a supervisor who misses the earliest open block and a stand-in
// covering the next one, through the Vertretungsplan's route; blocks that
// ended, blocks without staff and the sick colleague's blocks stay as they
// are, and the weekend has none.
func TestSeedTodaysBlockStaffMarksAbsenceAndCover(t *testing.T) {
	t.Parallel()

	var paths []string
	var bodies []map[string]any
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" {
			_, _ = fmt.Fprint(w, `{"status":"success","data":{"instances":[`+
				`{"id":"71","title":"Theater","status":"planned","start_time":"16:00:00","end_time":"17:00:00","room_id":"1","activity_group_id":"9","staff":[{"staff_id":"31"}]},`+
				`{"id":"72","title":"Chor","status":"planned","start_time":"14:00:00","end_time":"15:00:00","room_id":"1","activity_group_id":"9","staff":[{"staff_id":"32"}]},`+
				`{"id":"73","title":"Lernzeit","status":"planned","start_time":"13:00:00","end_time":"14:00:00","room_id":"1","activity_group_id":"9","staff":[{"staff_id":"33"}]},`+
				`{"id":"74","title":"Leer","status":"planned","start_time":"12:00:00","end_time":"13:30:00","room_id":"1","activity_group_id":"9","staff":[]},`+
				`{"id":"75","title":"Vorbei","status":"planned","start_time":"08:00:00","end_time":"09:00:00","room_id":"1","activity_group_id":"9","staff":[{"staff_id":"34"}]}]}}`)
			return
		}
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		bodies = append(bodies, body)
		_, _ = fmt.Fprint(w, `{"status":"success","data":{}}`)
	})
	defer srv.Close()

	fs := NewFixedSeeder(newTestClient(srv.URL, false), false, "")
	fs.staffIDs = map[string]int64{}
	for i, staff := range DemoStaff {
		fs.staffIDs[staff.FirstName+" "+staff.LastName] = int64(100 + i)
	}
	rt := &Runtime{Client: fs.client, FixedSeeder: fs, TenantAuth: AuthRef{Token: "admin"}}
	tuesday := seedDate{Time: time.Date(2026, time.October, 20, 0, 0, 0, 0, time.UTC)}
	noon := time.Date(2026, time.October, 20, 12, 0, 0, 0, seedBerlinLocation())
	require.NoError(t, seedTodaysBlockStaff(rt, tuesday, noon))

	assert.Equal(t, []string{
		"GET /api/timetable/instances",
		"POST /api/timetable/instances/73/deviations",
		"POST /api/timetable/instances/72/deviations",
	}, paths)
	require.Len(t, bodies, 2)
	assert.NotContains(t, bodies[0], "substitutions", "the earliest block is only missed")
	require.Contains(t, bodies[1], "substitutions", "the next one is covered")
	cover := bodies[1]["substitutions"].([]any)[0].(map[string]any)
	assert.Equal(t, float64(32), cover["absent_staff_id"])
	assert.Equal(t, float64(100+len(DemoStaff)-2), cover["substitute_staff_id"], "the free internal colleague with the largest id")

	paths = nil
	saturday := seedDate{Time: time.Date(2026, time.October, 24, 0, 0, 0, 0, time.UTC)}
	require.NoError(t, seedTodaysBlockStaff(rt, saturday, noon))
	assert.Empty(t, paths)
}

// The stand-in is a colleague off the block and not away today, with a
// larger staff id than the absent one (#7683).
func TestBlockStandInPicksAFreeColleagueWithALargerID(t *testing.T) {
	t.Parallel()
	staff := []int64{10, 11, 12, 13, 14, 15, 16, 17, 18, 19}
	var block seedChangeableBlock
	require.NoError(t, json.Unmarshal([]byte(`{"staff":[{"staff_id":"11"},{"staff_id":"19"}]}`), &block))
	assert.Equal(t, int64(18), blockStandIn(staff, block, 11))
	assert.Equal(t, int64(0), blockStandIn(staff, block, 19), "no larger id is free")
}
