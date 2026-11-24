package readstate_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

func TestOperationCodeKeepsTheOwnersLabel(t *testing.T) {
	t.Parallel()
	refusal := fmt.Errorf("save: %w", readstate.ErrChanged)
	cases := []struct {
		label, want string
		err         error
	}{
		{"not_found", "not_found", refusal},
		{"internal_error", "internal_error", errors.New("boom")},
		{"internal", readstate.ChangedCode, refusal},
		{"internal_error", readstate.ChangedCode, refusal},
	}
	for _, tc := range cases {
		if got := readstate.OperationCode(tc.label, tc.err); got != tc.want {
			t.Errorf("OperationCode(%q, %v) = %q, want %q", tc.label, tc.err, got, tc.want)
		}
	}
}
