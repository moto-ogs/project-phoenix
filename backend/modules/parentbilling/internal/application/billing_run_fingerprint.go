package application

import (
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The release of a holiday run issues exactly the preview the Abrechnung
// checked (#6506, ADR 0204), as the monthly run does (#5916): the preview
// carries a fingerprint of its content, and the release computes it again
// under the lock of the run and refuses a missing or other one before it
// reserves a number. Count and sum alone let a correction move an amount
// from one family to another unseen.

// fingerprintDocument is what the fingerprint covers of a draft invoice:
// the draft as the preview shows it and the family it belongs to. The kind
// of document stands once beside the documents.
type fingerprintDocument struct {
	Document    parentbilling.BillingDocument `json:"document"`
	FamilyEmail string                        `json:"family_email"`
}

// holidayPreviewFingerprint names the content of the preview of a holiday
// run: every draft in the order the release numbers them, each with its
// recipient, postal address, debtor number, payment and due date, mandate,
// children, positions, corrections, the corrections it carries over and
// the cancelled invoice it replaces; the confirmed registrations left out;
// the due dates of the run; and the kind of document the release freezes
// with the legal remedy of a fee notice (#4688). The order of the drafts
// follows the registrations, so reading them in another order changes
// nothing.
func holidayPreviewFingerprint(run parentbilling.BillingRun, current preview, documentKind, legalRemedy string) string {
	documents := make([]fingerprintDocument, len(current.documents))
	for i, document := range current.documents {
		document.DocumentKind = ""
		documents[i] = fingerprintDocument{Document: document, FamilyEmail: document.FamilyEmail}
	}
	return readstate.Fingerprint(struct {
		Run          int64                      `json:"run"`
		Documents    []fingerprintDocument      `json:"documents"`
		Unbilled     int                        `json:"unbilled"`
		DueDates     []parentbilling.RunDueDate `json:"due_dates"`
		DocumentKind string                     `json:"document_kind"`
		LegalRemedy  string                     `json:"legal_remedy"`
	}{run.ID.Int64(), documents, current.unbilled, current.dueDates.InPaymentOrder(), documentKind, legalRemedy})
}
