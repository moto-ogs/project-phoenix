package presenceprojectionhttp

import (
	"os"
	"regexp"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
