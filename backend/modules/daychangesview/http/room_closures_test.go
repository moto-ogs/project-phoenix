package daychangesviewhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// closeTestRoom enters a closure of the room as the school's room page does.
func closeTestRoom(t *testing.T, db *testpkg.DB, tenantID, roomID int64, from, until calendar.Date, reason string) {
	t.Helper()
	_, err := db.ExecContext(testpkg.Ctx(t), `INSERT INTO facilities.room_closures (tenant_id, room_id, start_date, end_date, reason)
  VALUES (?, ?, ?, ?, ?)`, tenantID, roomID, from, until, reason)
	require.NoError(t, err)
}

// roomClosureWire is the part of an entry the Räume source fills.
type roomClosureWire struct {
	Kind    string  `json:"kind"`
	Section string  `json:"section"`
	Since   *string `json:"since"`
	Until   *string `json:"until"`
	Room    *struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"room"`
	RoomClosure *struct {
		Reason string `json:"reason"`
	} `json:"room_closure"`
	Link *struct {
		Target string `json:"target"`
		RoomID string `json:"room_id"`
	} `json:"link"`
	People []json.RawMessage `json:"people"`
}

// roomClosureLines are the room_closed entries of an answer body.
func roomClosureLines(t *testing.T, body string) []roomClosureWire {
	t.Helper()
	var envelope struct {
		Data struct {
			Entries []roomClosureWire `json:"entries"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal([]byte(body), &envelope))
	lines := []roomClosureWire{}
	for _, entry := range envelope.Data.Entries {
		if entry.Kind == "room_closed" {
			lines = append(lines, entry)
		}
	}
	return lines
}

// TestRoomClosuresInHeuteAnders is Seam 1 of the room closure in "Heute
// anders" (#8161). The staff portal shows today's closures to an account
// that reads the rooms, with room, reason, "seit"/"bis" and the room's page,
// and without any person. moto schule shows them without a link. An account
// without rooms:read, a closure of another day and one of another school
// show nothing; the parents' child day has no room closure at all. The
// statement count stays flat in the number of closures.
func TestRoomClosuresInHeuteAnders(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	tenantID := testpkg.Tenant(t)
	_, account := testpkg.CreateTestTeacherWithAccount(t, db, "Rita", "Raum")
	staffRouter := newRouter(t, db, day)
	schoolRouter := newSchoolRouter(t, db, day)

	werkraum := testpkg.CreateTestRoom(t, db, "Werkraum Sperre")
	turnhalle := testpkg.CreateTestRoom(t, db, "Turnhalle Sperre")
	closeTestRoom(t, db, tenantID, werkraum.ID, day, day, "Wasserschaden")
	closeTestRoom(t, db, tenantID, turnhalle.ID, day.AddDays(-2), day.AddDays(3), "Neuer Boden")
	// Tomorrow's closure is not today's change.
	musik := testpkg.CreateTestRoom(t, db, "Musikraum Sperre")
	closeTestRoom(t, db, tenantID, musik.ID, day.AddDays(1), day.AddDays(1), "Konzertprobe")
	// Archived rooms only remain reachable through their history. A current
	// closure must not turn that historical room into a school-day notice.
	archived := testpkg.CreateTestRoom(t, db, "Archivierter Raum")
	closeTestRoom(t, db, tenantID, archived.ID, day, day, "Alte Sperre")
	_, err := db.ExecContext(testpkg.Ctx(t), `UPDATE facilities.rooms SET archived_at = now() WHERE tenant_id = ? AND id = ?`, tenantID, archived.ID)
	require.NoError(t, err)

	// A closure of another school on the same database never reaches this
	// one (the subtests below assert its absence).
	t.Run("another school closes a room today", func(t *testing.T) {
		foreignTenant := testpkg.OwnTenant(t)
		testpkg.EnsureTestTenant(t, db, foreignTenant)
		foreignRoom := testpkg.CreateTestRoom(t, db, "Fremder Raum")
		closeTestRoom(t, db, foreignTenant, foreignRoom.ID, day, day, "Fremde Sperre")
		var stored int
		require.NoError(t, db.NewRaw(`SELECT count(*) FROM facilities.room_closures WHERE tenant_id = ? AND reason = 'Fremde Sperre'`, foreignTenant).Scan(testpkg.Ctx(t), &stored))
		require.Equal(t, 1, stored)
	})

	t.Run("the staff portal names room and reason and links the room", func(t *testing.T) {
		overview, body := read(t, staffRouter, account.ID, tenantID, "rooms:read")
		assert.Equal(t, "loaded", sourceStatus(overview, "room_closures"))
		lines := roomClosureLines(t, body)
		require.Len(t, lines, 2, body)
		byRoom := map[string]roomClosureWire{}
		for _, line := range lines {
			require.NotNil(t, line.Room)
			byRoom[line.Room.ID] = line
			assert.Equal(t, "school", line.Section)
			assert.Empty(t, line.People, "a room closure names no person")
			require.NotNil(t, line.Link)
			assert.Equal(t, "room", line.Link.Target)
			assert.Equal(t, line.Room.ID, line.Link.RoomID)
		}
		werk := byRoom[fmt.Sprint(werkraum.ID)]
		assert.Equal(t, werkraum.Name, werk.Room.Name)
		require.NotNil(t, werk.RoomClosure)
		assert.Equal(t, "Wasserschaden", werk.RoomClosure.Reason)
		assert.Nil(t, werk.Since)
		assert.Nil(t, werk.Until)
		halle := byRoom[fmt.Sprint(turnhalle.ID)]
		require.NotNil(t, halle.Since)
		require.NotNil(t, halle.Until)
		assert.Equal(t, day.AddDays(-2).String(), *halle.Since)
		assert.Equal(t, day.AddDays(3).String(), *halle.Until)
		assert.NotContains(t, body, "Konzertprobe", "tomorrow's closure waits for tomorrow")
		assert.NotContains(t, body, "Fremde Sperre", "another school's closure stays there")
		assert.NotContains(t, body, "Alte Sperre", "an archived room has no current notice")
	})

	t.Run("without rooms:read the staff portal shows none", func(t *testing.T) {
		overview, body := read(t, staffRouter, account.ID, tenantID, "schedules:read")
		assert.Equal(t, "loaded", sourceStatus(overview, "room_closures"), "a missing right is no failure")
		assert.Empty(t, roomClosureLines(t, body))
	})

	t.Run("moto schule shows them without a link", func(t *testing.T) {
		_, body := readSchool(t, schoolRouter, account.ID, tenantID, "class_day:read", "rooms:read")
		lines := roomClosureLines(t, body)
		require.Len(t, lines, 2, body)
		for _, line := range lines {
			assert.Nil(t, line.Link, "moto schule has no room page")
		}
		assert.NotContains(t, body, "Fremde Sperre", "another school's closure stays there")
		assert.NotContains(t, body, "Alte Sperre", "an archived room has no current notice")
		_, body = readSchool(t, schoolRouter, account.ID, tenantID, "class_day:read", "calendar:school")
		assert.Empty(t, roomClosureLines(t, body), "a Lehrkraft without rooms:read sees none")
	})

	t.Run("the parents' child day has no room closure", func(t *testing.T) {
		chain := testpkg.CreateTestParentGuardianChain(t, db)
		token := testutil.MintTestJWT(t, testpkg.ParentTestClaims(int(chain.AccountID)))
		inner, err := api.NewChildDayChangesTestRouter(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), day)
		require.NoError(t, err)
		parents := chi.NewRouter()
		parents.Use(testpkg.TenantRuntimeMiddleware(t, db))
		parents.Mount("/", inner)
		code, answer, body := readChildDay(t, parents, token, chain.StudentID)
		require.Equal(t, http.StatusOK, code, body)
		assert.Empty(t, childSourceStatus(answer, "room_closures"))
		assert.NotContains(t, body, "room_closed")
		assert.NotContains(t, body, "Wasserschaden")
	})

	t.Run("the statements stay flat in the number of closures", func(t *testing.T) {
		counter := testpkg.CaptureQueries(t, db)
		counter.Reset()
		read(t, staffRouter, account.ID, tenantID, "rooms:read")
		before := len(counter.Queries())
		require.Positive(t, before)
		for i := 0; i < 3; i++ {
			room := testpkg.CreateTestRoom(t, db, fmt.Sprintf("Weiterer Raum %d", i))
			closeTestRoom(t, db, tenantID, room.ID, day, day, "Malerarbeiten")
		}
		counter.Reset()
		_, body := read(t, staffRouter, account.ID, tenantID, "rooms:read")
		require.Len(t, roomClosureLines(t, body), 5)
		assert.Len(t, counter.Queries(), before)
	})
}
