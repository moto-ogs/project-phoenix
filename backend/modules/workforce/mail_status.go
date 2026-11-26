package workforce

import (
	"context"
	"fmt"
)

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
	AwaitingFeedback bool
	MailID           int64
	RelatedType      string
	RelatedID        int64
	Outcome          string
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
	AbsenceRequestMails(ctx context.Context, absenceIDs []int64) (map[int64]map[string]int, bool, error)
	// AbsenceDecisionMails reports the outcome of each absence's newest mail
	// to the applicant about an approval, a decline or a question; an absence
	// without such a mail has no key.
	AbsenceDecisionMails(ctx context.Context, absenceIDs []int64) (map[int64]string, bool, error)
}

// NewAbsenceMailStatus reads the absence request mails over the outcomes,
// one read per related type whatever the number of absences. Without
// outcomes there is no status: nil.
func NewAbsenceMailStatus(outcomes MailOutcomes) AbsenceMailStatus {
	if outcomes == nil {
		return nil
	}
	return absenceMailStatus{outcomes: outcomes}
}

type absenceMailStatus struct{ outcomes MailOutcomes }

// AbsenceRequestMails counts the latest notice round per absence. A question
// closes a round: the received mails after the newest question mail are the
// notice of the resubmitted request, the older ones belong to the first one.
func (s absenceMailStatus) AbsenceRequestMails(ctx context.Context, absenceIDs []int64) (map[int64]map[string]int, bool, error) {
	counts := map[int64]map[string]int{}
	if len(absenceIDs) == 0 {
		return counts, false, nil
	}
	mails, err := s.outcomes.MailOutcomes(ctx, absenceIDs, AbsenceMailRequestQuestion, AbsenceMailRequestReceived)
	if err != nil {
		return nil, false, fmt.Errorf("absence mail status: read the notice mails: %w", err)
	}
	active := false
	lastQuestion := map[int64]int64{}
	for _, mail := range mails {
		if mail.RelatedType == AbsenceMailRequestQuestion && mail.MailID > lastQuestion[mail.RelatedID] {
			lastQuestion[mail.RelatedID] = mail.MailID
		}
	}
	for _, mail := range mails {
		if mail.RelatedType != AbsenceMailRequestReceived || mail.MailID < lastQuestion[mail.RelatedID] {
			continue
		}
		if counts[mail.RelatedID] == nil {
			counts[mail.RelatedID] = map[string]int{}
		}
		counts[mail.RelatedID][mail.Outcome]++
		active = active || mail.AwaitingFeedback
	}
	return counts, active, nil
}

// AbsenceDecisionMails reports the newest decision or question mail per
// absence; a later mail replaces an earlier one, as a decision follows a
// question.
func (s absenceMailStatus) AbsenceDecisionMails(ctx context.Context, absenceIDs []int64) (map[int64]string, bool, error) {
	outcomes := map[int64]string{}
	if len(absenceIDs) == 0 {
		return outcomes, false, nil
	}
	mails, err := s.outcomes.MailOutcomes(ctx, absenceIDs, AbsenceMailRequestApproved, AbsenceMailRequestDeclined, AbsenceMailRequestQuestion)
	if err != nil {
		return nil, false, fmt.Errorf("absence mail status: read the decision mails: %w", err)
	}
	newest := map[int64]MailOutcome{}
	for _, mail := range mails {
		if mail.MailID > newest[mail.RelatedID].MailID {
			newest[mail.RelatedID] = mail
			outcomes[mail.RelatedID] = mail.Outcome
		}
	}
	for _, mail := range newest {
		if mail.AwaitingFeedback {
			return outcomes, true, nil
		}
	}
	return outcomes, false, nil
}
