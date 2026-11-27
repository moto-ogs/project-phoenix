package carerequests

// Service owns the weekly-care and pickup-change request lifecycle.
// Callers authorize guardian access and supply the ambient tenant transaction.
// Decisions enforce staff review access; effects are registered after commit.
type Service interface {
	Submissions
	Reads
	Edits
	Decisions
}
