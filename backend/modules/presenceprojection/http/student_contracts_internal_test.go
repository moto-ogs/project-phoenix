package presenceprojectionhttp

import (
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The registration lists query parameters by hand, because reflection cannot
// see what a handler reads. This keeps the list of the student list route
// equal to the keys its parsing code reads.
func TestStudentListContractNamesEveryQueryParameterTheHandlerReads(t *testing.T) {
	t.Parallel()
	read := regexp.MustCompile(`Query\(\)(?:\.Get\("|\[")([a-z_]+)"`)
	// page and page_size are read by common.ParsePagination.
	parsed := map[string]bool{"page": true, "page_size": true}
	for _, file := range []string{"list_helpers.go", "student_list_handlers.go", "care_offering_filter.go", "enrollment_answer_filter.go"} {
		source, err := os.ReadFile(file)
		require.NoError(t, err)
		for _, match := range read.FindAllStringSubmatch(string(source), -1) {
			parsed[match[1]] = true
		}
	}
	var want, registered []string
	for name := range parsed {
		want = append(want, name)
	}
	for _, param := range StudentRouteContracts()[0].Query {
		registered = append(registered, param.Name)
	}
	sort.Strings(want)
	sort.Strings(registered)
	assert.Equal(t, want, registered)
}

// The child list answers every row up to the cap when the caller sends no
// usable page size, and never more than the cap (#7563).
func TestStudentListPageSizeDefaultsToAndStopsAtTheCap(t *testing.T) {
	t.Parallel()
	for query, want := range map[string]int{
		"":                 studentListMaxPageSize,
		"?page_size=abc":   studentListMaxPageSize,
		"?page_size=0":     studentListMaxPageSize,
		"?page_size=-3":    studentListMaxPageSize,
		"?page_size=200":   200,
		"?page_size=1000":  studentListMaxPageSize,
		"?page_size=5000":  studentListMaxPageSize,
		"?page_size=10000": studentListMaxPageSize,
	} {
		request := httptest.NewRequest(http.MethodGet, "/"+query, nil)
		params := parseStudentListParams(request, calendar.NewDate(2026, time.September, 9))
		assert.Equalf(t, want, params.pageSize, "query %q", query)
	}
}
