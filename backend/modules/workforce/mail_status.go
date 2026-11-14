package workforce

import "context"

// What became of Workforce's mails (#7058): every mail shows its outcome
// where it started. Delivery keeps a mail's purpose as its related type and
// the entity as the related ID; Workforce owns the port that reads them back.

// The related types of the absence request mails; the related ID is the
// absence. The approvers get one received mail each per round, the applicant
// one mail per decision or question.
const (
	AbsenceMailRequestReceived = "absence_request_received"
	AbsenceMailRequestApproved = "absence_request_approved"
	AbsenceMailRequestDeclined = "absence_request_declined"
	AbsenceMailRequestQuestion = "absence_request_question"
)

// MailOutcome is what became of one Workforce mail, in Delivery's words
// ("queued", "accepted", "delivered", "undeliverable", ...).
type MailOutcome struct {
	MailID      int64
	RelatedType string
	RelatedID   int64
	Outcome     string
}

// MailOutcomes reads the outcomes of Workforce's mails in the caller's tenant
// transaction. It reports the mails of the related entities for each related
// type, oldest first within a type; an entity without a mail adds nothing.
// The root binds it to Delivery.
type MailOutcomes interface {
	MailOutcomes(ctx context.Context, relatedIDs []int64, relatedTypes ...string) ([]MailOutcome, error)
}

// AbsenceMailStatus tells both sides of an absence request what became of its
// mails (#7058). Neither read checks who may see the absence: the callers pass
// only absences they already show to the reader.
type AbsenceMailStatus interface {
	// AbsenceRequestMails counts the mails of each absence's latest notice to
	// the approvers by outcome. A resubmission after a question starts a new
	// notice; an absence without a notice mail has no key.
	AbsenceRequestMails(ctx context.Context, absenceIDs []int64) (map[int64]map[string]int, error)
	// AbsenceDecisionMails reports the outcome of each absence's newest mail
	// to the applicant about an approval, a decline or a question; an absence
	// without such a mail has no key.
	AbsenceDecisionMails(ctx context.Context, absenceIDs []int64) (map[int64]string, error)
}
