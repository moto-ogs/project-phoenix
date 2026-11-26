package api

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Today gets a cancelled, a reinstated and a moved block through the
// planner's routes; the sick colleague's covered blocks, blocks with a
// substitute and blocks without a series stay as they are. Only a block that
// has not ended takes its cancellation back.
func TestSeedTodaysBlockChangesCancelsReinstatesAndMoves(t *testing.T) {
	t.Parallel()

	var paths []string
	var moved map[string]any
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case "GET":
			_, _ = fmt.Fprint(w, `{"status":"success","data":{"instances":[`+
				`{"id":"61","title":"Frühbetreuung","status":"planned","start_time":"15:00:00","end_time":"17:00:00","room_id":"1","activity_group_id":"9","staff":[]},`+
				`{"id":"62","title":"Fußball","status":"planned","start_time":"14:00:00","end_time":"15:00:00","room_id":"1","activity_group_id":"9","staff":[{"staff_id":"31"}],"student_ids":["5","6"]},`+
				`{"id":"63","title":"Chor","status":"planned","start_time":"15:00:00","end_time":"16:00:00","room_id":"1","activity_group_id":"9","staff":[]},`+
				`{"id":"64","title":"Theater","status":"planned","start_time":"16:00:00","end_time":"17:00:00","room_id":"1","activity_group_id":"9","staff":[]},`+
				`{"id":"65","title":"Basteln","status":"planned","start_time":"13:00:00","end_time":"18:00:00","room_id":"1","activity_group_id":"9","staff":[{"staff_id":"32","is_substitute":true}]},`+
				`{"id":"66","title":"Spontan","status":"planned","start_time":"13:00:00","end_time":"18:00:00","room_id":"1","staff":[]},`+
				`{"id":"67","title":"Vorbei","status":"completed","start_time":"08:00:00","end_time":"09:00:00","room_id":"1","activity_group_id":"9","staff":[]}]}}`)
		case "PUT":
			require.NoError(t, json.NewDecoder(r.Body).Decode(&moved))
			_, _ = fmt.Fprint(w, `{"status":"success","data":{}}`)
		default:
			_, _ = fmt.Fprint(w, `{"status":"success","data":{}}`)
		}
	})
	defer srv.Close()

	fs := NewFixedSeeder(newTestClient(srv.URL, false), false, "")
	fs.roomIDs = map[string]int64{"OGS-Raum 1": 1, "Turnhalle": 2}
	rt := &Runtime{Client: fs.client, FixedSeeder: fs, TenantAuth: AuthRef{Token: "admin"}}
	tuesday := seedDate{Time: time.Date(2026, time.October, 20, 0, 0, 0, 0, time.UTC)}
	noon := time.Date(2026, time.October, 20, 12, 0, 0, 0, seedBerlinLocation())
	require.NoError(t, seedTodaysBlockChanges(rt, tuesday, noon))

	assert.Equal(t, []string{
		"GET /api/timetable/instances",
		"POST /api/timetable/instances/63/cancel",
		"POST /api/timetable/instances/64/cancel",
		"POST /api/timetable/instances/64/reinstate",
		"PUT /api/timetable/instances/62",
	}, paths)

	assert.Equal(t, "2", moved["room_id"])
	assert.Equal(t, "14:00", moved["start_time"])
	assert.Equal(t, []any{"31"}, moved["staff_ids"])
	assert.Equal(t, []any{"5", "6"}, moved["student_ids"])

	// In the evening every block has ended: no reinstatement.
	paths, moved = nil, nil
	evening := time.Date(2026, time.October, 20, 18, 0, 0, 0, seedBerlinLocation())
	require.NoError(t, seedTodaysBlockChanges(rt, tuesday, evening))
	assert.Equal(t, []string{
		"GET /api/timetable/instances",
		"POST /api/timetable/instances/64/cancel",
		"PUT /api/timetable/instances/63",
	}, paths)
}
