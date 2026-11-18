package workforce

import "context"

// Key rings a staff document file is sealed with (#3840). The values match
// the rings of the root's object store: "health" binds HEALTH_DATA_KEYS,
// "bank" binds BANK_DATA_KEYS.
const (
	StaffDocumentRingHealth = "health"
	StaffDocumentRingBank   = "bank"
)

// StaffDocumentStorageKind is the storage kind of staff document files.
const StaffDocumentStorageKind = "staff-documents"

// StaffDocumentKeyRing names the ring a staff document of the category is
// sealed with, or "" for a category stored unsealed. Sick notes are health
// data (Art. 9 GDPR) and go to the health ring; payslips carry the bank, tax
// and social security data that users.staff_financial_data seals with the
// bank ring (ADR 0188), so they go there too.
func StaffDocumentKeyRing(category string) string {
	switch category {
	case StaffDocumentCategoryAUBescheinigung:
		return StaffDocumentRingHealth
	case StaffDocumentCategoryLohnabrechnung:
		return StaffDocumentRingBank
	default:
		return ""
	}
}

// StaffDocumentFileReseal brings the stored file of one document onto ring
// and its active key and reports whether its bytes changed. The CLI root
// binds the object store; a file that is already gone is not an error.
type StaffDocumentFileReseal func(ctx context.Context, storedName, ring string) (bool, error)

// StaffDocumentFileSealResult contains counters only, never names or content.
type StaffDocumentFileSealResult struct {
	Scanned, Changed int
	LastID           int64
}

// StaffDocumentFileSeal seals the stored files of sick notes and payslips
// uploaded before #3840 and moves sealed ones onto the active key, one
// bounded batch of one school at a time. Each batch locks its document rows,
// so a concurrent delete waits, and the atomic exchange never re-creates a file a cleanup removed. The CLI
// root opens the school transaction per batch; never bind it to HTTP.
// Resume by replaying from zero.
type StaffDocumentFileSeal interface {
	Batch(ctx context.Context, schoolID, afterID int64, limit int, reseal StaffDocumentFileReseal) (StaffDocumentFileSealResult, error)
}
