package presenceprojectionhttp

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestListedFreeAnswersFollowTheChildrenTheListShows recounts the answers of
// a free question over the children the list shows (#7012): an answer only
// former pupils gave goes, the rest sort by the children shown, and a single
// answer left beside "Angabe vorhanden" would only repeat it, so it goes too.
func TestListedFreeAnswersFollowTheChildrenTheListShows(t *testing.T) {
	t.Parallel()
	listed := map[int64]bool{1: true, 2: true, 3: true, 4: true}
	filter := func(options ...EnrollmentAnswerOptionResponse) []EnrollmentAnswerFilterResponse {
		return []EnrollmentAnswerFilterResponse{{Key: "allergies", Label: "Allergien", Type: "textarea", Options: options}}
	}
	given := EnrollmentAnswerOptionResponse{Value: "*", Label: "Angabe vorhanden", Given: true, StudentIDs: []int64{1, 2, 3, 4, 9}}

	sorted := countListedAnswers(filter(given,
		EnrollmentAnswerOptionResponse{Value: "~a", Label: "Nüsse", StudentIDs: []int64{1, 9}},
		EnrollmentAnswerOptionResponse{Value: "~b", Label: "keine", StudentIDs: []int64{2, 3, 4}},
	), listed)
	require.Len(t, sorted, 1)
	require.Equal(t, []string{"Angabe vorhanden", "keine", "Nüsse"}, optionLabels(sorted[0].Options), "most children shown first")
	require.Equal(t, []int{4, 3, 1}, optionCounts(sorted[0].Options))

	alone := countListedAnswers(filter(given,
		EnrollmentAnswerOptionResponse{Value: "~a", Label: "Nüsse", StudentIDs: []int64{9}},
		EnrollmentAnswerOptionResponse{Value: "~b", Label: "keine", StudentIDs: []int64{1, 2, 3, 4}},
	), listed)
	require.Equal(t, []string{"Angabe vorhanden"}, optionLabels(alone[0].Options), "one answer left repeats \"Angabe vorhanden\"")
}

func optionLabels(options []EnrollmentAnswerOptionResponse) []string {
	out := make([]string, 0, len(options))
	for _, option := range options {
		out = append(out, option.Label)
	}
	return out
}

func optionCounts(options []EnrollmentAnswerOptionResponse) []int {
	out := make([]int, 0, len(options))
	for _, option := range options {
		out = append(out, option.Count)
	}
	return out
}
