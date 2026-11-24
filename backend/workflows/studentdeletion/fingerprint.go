package studentdeletion

import (
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// fingerprintOf binds a confirmation to the student and person versions and
// the counts the preview showed (readstate.Fingerprint, ADR 0311).
func fingerprintOf(studentUpdatedAt, personUpdatedAt time.Time, counts Counts) string {
	return readstate.Fingerprint(struct {
		StudentUpdatedAt int64  `json:"student_updated_at"`
		PersonUpdatedAt  int64  `json:"person_updated_at"`
		Counts           Counts `json:"counts"`
	}{StudentUpdatedAt: studentUpdatedAt.UnixNano(), PersonUpdatedAt: personUpdatedAt.UnixNano(), Counts: counts})
}

// equalFingerprint reports whether the confirmation names the current
// preview; whitespace around the token is ignored, an empty one never
// matches. The refusal keeps its own code (students.deletion_preview_changed).
func equalFingerprint(actual, expected string) bool {
	return readstate.Check(strings.TrimSpace(expected), actual) == nil
}
