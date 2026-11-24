package calendar_e2e_test

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	rootAPI "github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	calendarHTTP "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/require"
)

func TestPublicCalendarFeedPositiveGrowthQueryBudget(t *testing.T) {
	t.Parallel()
	testpkg.SetupIsolatedTestDB(t)
	db, module := setupCalendarModule(t)
	router := chi.NewRouter()
	router.Use(testpkg.TenantRuntimeMiddleware(t, db))
	router.Mount("/calendar", calendarHTTP.NewResource(module.Calendar, nil, slog.Default()).Router(rootAPI.TenantSessionChain))
	router.Get("/public/calendar/{token}", calendarHTTP.PublicFeed(module.Calendar))
	_, account := testpkg.CreateTestCalendarStaff(t, db, "Feed", "Growth")
	token := calendarToken(t, account.ID, permissions.CalendarOwn, permissions.CalendarManage)
	feedRec := doJSON(t, router, http.MethodGet, "/calendar/feed", token, nil)
	require.Equal(t, http.StatusOK, feedRec.Code, feedRec.Body.String())
	var feed feedE2EResponse
	require.NoError(t, json.Unmarshal(feedRec.Body.Bytes(), &feed))
	feedToken := feed.Data.URL[strings.LastIndexByte(feed.Data.URL, '/')+1:]
	require.NotEmpty(t, feedToken)
	count := 0
	for _, n := range []int{3, 8} {
		for count < n {
			rec := doJSON(t, router, http.MethodPost, "/calendar/appointments", token, map[string]any{
				"title": fmt.Sprintf("Feed growth %d", count), "start_date": "2026-01-08", "end_date": "2026-01-08", "start_time": "14:00", "end_time": "15:00", "delivery_mode": "informational",
			})
			require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
			count++
		}
		counter := testpkg.CaptureQueries(t, db)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/public/calendar/"+feedToken, nil))
		queries := counter.Measurement(counter.Queries())
		counter.Stop()
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		require.Equal(t, "text/calendar; charset=utf-8", rec.Header().Get("Content-Type"))
		require.Equal(t, n, strings.Count(rec.Body.String(), "BEGIN:VEVENT"))
		for i := range n {
			require.Contains(t, rec.Body.String(), fmt.Sprintf("SUMMARY:Feed growth %d", i))
		}
		t.Logf("public calendar staff-token N%d statements=%d", n, len(queries.Statements))
		querybudgets.AssertQueryBudget(t, "api.calendar.public_feed.staff", queries)
	}
}
