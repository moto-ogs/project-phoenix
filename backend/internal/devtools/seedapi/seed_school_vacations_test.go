package api

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The step hands the windows to the bound writer locally and to the
// demo-only operator route in the public demo (ADR 0298).
func TestSeedSchoolVacationsStepWritesThroughWriterOrDemoRoute(t *testing.T) {
	t.Parallel()

	var stored []SchoolVacationWindow
	step := seedSchoolVacationsStep{seeder: &Seeder{options: SeedOptions{SchoolVacations: func(_ context.Context, windows []SchoolVacationWindow) (int, error) {
		stored = windows
		return len(windows) * 16, nil
	}}}}
	require.NoError(t, step.Run(context.Background(), &Runtime{}))
	assert.Len(t, stored, 4)

	var path, authorization string
	var body struct {
		Vacations []SchoolVacationWindow `json:"vacations"`
	}
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		path, authorization = r.Method+" "+r.URL.Path, r.Header.Get("Authorization")
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"stored":64}}`))
	})
	defer srv.Close()
	demo := seedSchoolVacationsStep{seeder: &Seeder{options: SeedOptions{PresenceHistoryRoute: true}}}
	runtime := &Runtime{Client: newTestClient(srv.URL, false), OperatorAuth: AuthRef{Kind: AuthBearer, Token: "operator-token"}}
	require.NoError(t, demo.Run(context.Background(), runtime))
	assert.Equal(t, "POST /operator/demo-school-vacations", path)
	assert.Equal(t, "Bearer operator-token", authorization)
	assert.Len(t, body.Vacations, 4)

	require.NoError(t, seedSchoolVacationsStep{seeder: &Seeder{}}.Run(context.Background(), &Runtime{}), "without a writer the step skips")
}

func TestSeedSchoolVacationWindowsStartNextWeek(t *testing.T) {
	t.Parallel()
	// Wednesday: the first vacation runs from next Monday to Friday.
	today := seedDate{Time: time.Date(2026, time.October, 28, 0, 0, 0, 0, time.UTC)}

	windows := seedSchoolVacationWindows(today)

	require.Len(t, windows, 4)
	assert.Equal(t, SchoolVacationWindow{Name: "Herbstferien", StartDate: "2026-11-02", EndDate: "2026-11-06"}, windows[0])
	assert.Equal(t, SchoolVacationWindow{Name: "Weihnachtsferien", StartDate: "2026-12-23", EndDate: "2027-01-06"}, windows[1],
		"the Christmas vacation crosses the year")
	assert.Equal(t, "2027-07-12", windows[3].StartDate)

	december := seedSchoolVacationWindows(seedDate{Time: time.Date(2026, time.December, 13, 0, 0, 0, 0, time.UTC)})
	assert.Equal(t, "2026-12-23", december[1].StartDate, "a first vacation before Christmas keeps this Christmas")
	late := seedSchoolVacationWindows(seedDate{Time: time.Date(2026, time.December, 20, 0, 0, 0, 0, time.UTC)})
	assert.Equal(t, "2027-12-23", late[1].StartDate, "a first vacation after Christmas moves the year on")
}
