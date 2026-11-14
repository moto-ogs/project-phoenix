package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// AbsenceMailStatus reads what became of the absence request mails (#7058)
// from Delivery's outcomes. One read per related type, whatever the number of
// absences.
type AbsenceMailStatus struct {
	outcomes workforce.MailOutcomes
}

// NewAbsenceMailStatus requires the outcome read.
func NewAbsenceMailStatus(outcomes workforce.MailOutcomes) (*AbsenceMailStatus, error) {
	if outcomes == nil {
		return nil, errors.New("absence mail status: the mail outcomes are required")
	}
	return &AbsenceMailStatus{outcomes: outcomes}, nil
}

// AbsenceRequestMails counts the latest notice round per absence. A question
// closes a round: the received mails after the newest question mail are the
// notice of the resubmitted request, the older ones belong to the first one.
func (s *AbsenceMailStatus) AbsenceRequestMails(ctx context.Context, absenceIDs []int64) (map[int64]map[string]int, error) {
	counts := map[int64]map[string]int{}
	if len(absenceIDs) == 0 {
		return counts, nil
	}
	mails, err := s.outcomes.MailOutcomes(ctx, absenceIDs, workforce.AbsenceMailRequestQuestion, workforce.AbsenceMailRequestReceived)
	if err != nil {
		return nil, fmt.Errorf("absence mail status: read the notice mails: %w", err)
	}
	lastQuestion := map[int64]int64{}
	for _, mail := range mails {
		if mail.RelatedType == workforce.AbsenceMailRequestQuestion && mail.MailID > lastQuestion[mail.RelatedID] {
			lastQuestion[mail.RelatedID] = mail.MailID
		}
	}
	for _, mail := range mails {
		if mail.RelatedType != workforce.AbsenceMailRequestReceived || mail.MailID < lastQuestion[mail.RelatedID] {
			continue
		}
		if counts[mail.RelatedID] == nil {
			counts[mail.RelatedID] = map[string]int{}
		}
		counts[mail.RelatedID][mail.Outcome]++
	}
	return counts, nil
}

// AbsenceDecisionMails reports the newest decision or question mail per
// absence; a later mail replaces an earlier one, as a decision follows a
// question.
func (s *AbsenceMailStatus) AbsenceDecisionMails(ctx context.Context, absenceIDs []int64) (map[int64]string, error) {
	outcomes := map[int64]string{}
	if len(absenceIDs) == 0 {
		return outcomes, nil
	}
	mails, err := s.outcomes.MailOutcomes(ctx, absenceIDs,
		workforce.AbsenceMailRequestApproved, workforce.AbsenceMailRequestDeclined, workforce.AbsenceMailRequestQuestion)
	if err != nil {
		return nil, fmt.Errorf("absence mail status: read the decision mails: %w", err)
	}
	newest := map[int64]int64{}
	for _, mail := range mails {
		if mail.MailID > newest[mail.RelatedID] {
			newest[mail.RelatedID] = mail.MailID
			outcomes[mail.RelatedID] = mail.Outcome
		}
	}
	return outcomes, nil
}
