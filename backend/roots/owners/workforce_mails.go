package owners

import (
	"context"
	"errors"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	delivery "github.com/moto-ogs/project-phoenix/modules/delivery/runtime"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// WorkforceMails reads what became of Workforce's mails (#7058): the payroll
// link and notices, the absence request mails. All of them are transactional
// mails whose related entity Workforce named; the read runs in the caller's
// tenant transaction.
type WorkforceMails struct{ Outcomes delivery.EmailOutcomes }

// workforceMailOutcomes binds the outcome read of the durable outbox; a root
// without Delivery's runtime composes no mail status.
func workforceMailOutcomes(durable OutboxEnqueuer) workforce.MailOutcomes {
	if durable.Runtime == nil || durable.Runtime.EmailOutcomes == nil {
		return nil
	}
	return WorkforceMails{Outcomes: durable.Runtime.EmailOutcomes}
}

// MailOutcomes reads the mails of each related type, one read per type.
func (m WorkforceMails) MailOutcomes(ctx context.Context, relatedIDs []int64, relatedTypes ...string) ([]workforce.MailOutcome, error) {
	if len(relatedIDs) == 0 || len(relatedTypes) == 0 {
		return nil, nil
	}
	if m.Outcomes == nil {
		return nil, errors.New("workforce mails: delivery outcomes are not configured")
	}
	tenantID, err := tenant.TenantFromContext(ctx)
	if err != nil {
		return nil, err
	}
	var outcomes []workforce.MailOutcome
	for _, relatedType := range relatedTypes {
		reports, err := m.Outcomes.EmailOutcomes(ctx, tenantID.Int64(), deliveryContract.EmailOutcomeQuery{
			RelatedType: relatedType, RelatedIDs: relatedIDs, Kinds: []string{TransactionalMailKind},
		})
		if err != nil {
			return nil, err
		}
		for _, report := range reports {
			outcomes = append(outcomes, workforce.MailOutcome{
				MailID: report.MailID, RelatedType: report.RelatedType, RelatedID: report.RelatedID, Outcome: string(report.Outcome),
			})
		}
	}
	return outcomes, nil
}
