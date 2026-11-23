package requestreviewhttp_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// decidePathVersion is the version of the request a decide path names, as
// the queue the reviewer decides from emits it.
func decidePathVersion(t testing.TB, path string) string {
	t.Helper()
	for prefix, version := range map[string]func(testing.TB, int64) string{
		"/master-data-change-requests/":   testpkg.MasterDataRequestVersion,
		"/care-schedule-change-requests/": testpkg.CareRequestVersion,
		"/offering-change-requests/":      testpkg.OfferingRequestVersion,
		"/excused-absence-requests/":      testpkg.ExcusedRequestVersion,
	} {
		if rest, ok := strings.CutPrefix(path, prefix); ok {
			id, err := strconv.ParseInt(strings.TrimSuffix(rest, "/decide"), 10, 64)
			require.NoError(t, err, path)
			return version(t, id)
		}
	}
	t.Fatalf("no request route in %s", path)
	return ""
}
