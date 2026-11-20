package presenceprojectionhttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetStudent_CheckedOutReadsAbsentSinceCheckout pins the checked-out
// location on the student payload, which replaced the retired
// /students/{id}/current-location endpoint (#4431): a full-access reader sees
// "Abwesend" with the checkout time.
func TestGetStudent_CheckedOutReadsAbsentSinceCheckout(t *testing.T) {
	t.Parallel()

	tc := setupStudentsRoute(t)
	student := testpkg.CreateTestStudent(t, tc.db, "CheckedOut", "Payload", "CO2")
	staff := testpkg.CreateTestStaff(t, tc.db, "CheckedOut", "PayloadStaff")
	device := testpkg.CreateTestDevice(t, tc.db, "checkout-payload-device")
	// Minutes, not hours, keep both stamps on today's date.
	now := time.Now()
	checkOut := now.Add(-1 * time.Minute).Truncate(time.Second)
	testpkg.CreateTestAttendance(t, tc.db, student.ID, staff.ID, device.ID, now.Add(-2*time.Minute), &checkOut)

	req := testutil.NewRequest("GET", fmt.Sprintf("/%d", student.ID), nil)
	rr := authExec(t, tc, req, testutil.AdminTestClaims(1), []string{"admin:*"})
	require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())

	var response struct {
		Data struct {
			Location      string     `json:"current_location"`
			LocationSince *time.Time `json:"location_since"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
	assert.Equal(t, "Abwesend", response.Data.Location)
	require.NotNil(t, response.Data.LocationSince)
	assert.True(t, checkOut.Equal(*response.Data.LocationSince), "location_since %s, want %s", response.Data.LocationSince, checkOut)
}
