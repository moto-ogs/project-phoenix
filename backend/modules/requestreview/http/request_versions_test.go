package requestreviewhttp_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/requestreview"
)

// queueVersion is the expected_version of one open request as the queue
// the reviewer decides from emits it (ADR 0311): the decision sends it
// back, never a token the test builds from the stored row.
func queueVersion(t *testing.T, tc *testContext, requestType string, id int64) string {
	t.Helper()
	want := strconv.FormatInt(id, 10)
	query := url.Values{"types": {requestType}}
	for {
		rr := authExec(t, tc, testutil.NewRequest("GET", "/change-requests?"+query.Encode(), nil), testutil.AdminTestClaims(1), []string{"admin:*"})
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		var page aggListEnvelope
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &page))
		for _, item := range page.Data.Items {
			if item.RequestType == requestType && item.requestID(t) == want {
				require.NotEmpty(t, item.ExpectedVersion, "the queue must carry the request's token")
				return item.ExpectedVersion
			}
		}
		if page.Data.NextCursor == "" {
			t.Fatalf("open %s request %d is not in the review queue", requestType, id)
			return ""
		}
		query.Set("cursor", page.Data.NextCursor)
	}
}

// decidePathVersion is the version of the request a decide path names, as
// the queue the reviewer decides from emits it.
func decidePathVersion(t *testing.T, tc *testContext, path string) string {
	t.Helper()
	for prefix, requestType := range map[string]string{
		"/master-data-change-requests/":   requestreview.TypeMasterData,
		"/care-schedule-change-requests/": requestreview.TypeCareSchedule,
		"/offering-change-requests/":      requestreview.TypeOffering,
		"/excused-absence-requests/":      requestreview.TypeExcused,
	} {
		if rest, ok := strings.CutPrefix(path, prefix); ok {
			id, err := strconv.ParseInt(strings.TrimSuffix(rest, "/decide"), 10, 64)
			require.NoError(t, err, path)
			return queueVersion(t, tc, requestType, id)
		}
	}
	t.Fatalf("no request route in %s", path)
	return ""
}
