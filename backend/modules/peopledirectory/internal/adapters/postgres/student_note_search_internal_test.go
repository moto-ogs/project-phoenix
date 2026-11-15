package postgres

import (
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
	"github.com/stretchr/testify/assert"
)

// TestNoteSearchKeepsTheTypedTextOutOfTheLog: bun writes bound values into
// the logged SQL, so the statement carrying the search text opens with the
// marker that makes the query log drop its literals (ADR 0231 point 5).
func TestNoteSearchKeepsTheTypedTextOutOfTheLog(t *testing.T) {
	t.Parallel()
	assert.True(t, strings.HasPrefix(searchNotesSQL, collation.RedactLiteralsInLog))
}
