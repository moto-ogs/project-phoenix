package careplan

import "context"

// StudentDocumentRingHealth names the health key ring (HEALTH_DATA_KEYS) of
// the root's object store (#3840).
const StudentDocumentRingHealth = "health"

// StudentDocumentKeyRing names the ring a child document of the category is
// sealed with, or "" for a category stored unsealed. The health categories
// (Attest, Impfnachweis, Medikamentenplan) hold Art. 9 GDPR health data and
// are sealed with the health ring, like the child's health information.
func StudentDocumentKeyRing(category string) string {
	if IsHealthStudentDocumentCategory(category) {
		return StudentDocumentRingHealth
	}
	return ""
}

// StudentDocumentFileReseal brings the stored file of one document onto ring
// and its active key and reports whether its bytes changed. The CLI root
// binds the object store; a file that is already gone is not an error.
type StudentDocumentFileReseal func(ctx context.Context, storedName, ring string) (bool, error)

// StudentDocumentFileSealResult contains counters only, never names or content.
type StudentDocumentFileSealResult struct {
	Scanned, Changed int
	LastID           int64
}

// StudentDocumentFileSeal seals the stored files of child health documents
// uploaded before #3840 and moves sealed ones onto the active key, one
// bounded batch of one school at a time. Each batch locks its document rows,
// so a concurrent delete waits, and the atomic exchange never re-creates a file a cleanup removed. The CLI
// root opens the school transaction per batch; never bind it to HTTP.
// Resume by replaying from zero.
type StudentDocumentFileSeal interface {
	Batch(ctx context.Context, schoolID, afterID int64, limit int, reseal StudentDocumentFileReseal) (StudentDocumentFileSealResult, error)
}
