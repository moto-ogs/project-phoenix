package cmd

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Every cleanup subcommand is assigned to retention or Basis; none belongs
// to an additional module (#4895).
func TestEveryCleanupCommandHasAScope(t *testing.T) {
	t.Parallel()

	// Retention still runs for schools that cancel a module (#4812).
	// Basis repairs apply to sessions, attendance days and supervisions at every school.
	cleanupCommandScopes := map[string]string{
		"timetable":     "retention",
		"time-tracking": "retention",
		"visits":        "retention",
		"preview":       "retention",
		"stats":         "retention",
		"tokens":        "retention",
		"invitations":   "retention",
		"rate-limits":   "retention",
		"attendance":    "basis",
		"sessions":      "basis",
		"supervisors":   "basis",
	}
	for _, command := range cleanupCmd.Commands() {
		scope, ok := cleanupCommandScopes[command.Name()]
		assert.Truef(t, ok, "cleanup %s belongs to no scope: add it to cleanupCommandScopes", command.Name())
		assert.Containsf(t, []string{"retention", "basis"}, scope, "cleanup %s", command.Name())
	}
}
