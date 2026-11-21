package parentbillinghttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/render"
	"github.com/stretchr/testify/require"
)

func TestHolidayRebookingRequestBindsIDs(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		ids  string
	}{
		{"strings", `"week_id":"9007199254740993","time_model_id":"9007199254740995"`},
		{"numbers", `"week_id":9007199254740993,"time_model_id":9007199254740995`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(`{"bookings":[{`+tc.ids+`}]}`))
			r.Header.Set("Content-Type", "application/json")
			var req HolidayRebookingRequest
			require.NoError(t, render.Bind(r, &req))
			require.Len(t, req.Bookings, 1)
			require.Equal(t, int64(9007199254740993), int64(req.Bookings[0].WeekID))
			require.Equal(t, int64(9007199254740995), int64(req.Bookings[0].TimeModelID))
		})
	}
}

func TestHolidayRebookingRequestRejectsInvalidIDs(t *testing.T) {
	t.Parallel()
	for _, value := range []string{`"abc"`, `"9223372036854775808"`, `1.5`} {
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			for _, field := range []string{"week_id", "time_model_id"} {
				r := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(`{"bookings":[{"`+field+`":`+value+`}]}`))
				r.Header.Set("Content-Type", "application/json")
				var req HolidayRebookingRequest
				require.Error(t, render.Bind(r, &req))
			}
		})
	}
}
