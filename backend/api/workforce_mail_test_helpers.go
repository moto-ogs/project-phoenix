//go:build testhooks

package api

import (
	"context"

	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// WorkforceMailOutboxForTests is Delivery's real outbox as the root binds it
// for Workforce's mails (#7058): the mail status the routes read and the
// enqueue of one transactional mail as the absence notifications write it,
// for the school of ctx and in its transaction.
func WorkforceMailOutboxForTests(db transactionruntime.Database, unit tenant.UnitOfWork) (
	workforce.AbsenceMailStatus, func(ctx context.Context, relatedType string, relatedID int64, address string) error, error,
) {
	delivery, err := NewDeliveryTestModule(db, unit)
	if err != nil {
		return nil, nil, err
	}
	outbox := owners.OutboxEnqueuer{Outbox: delivery.EmailOutbox, Runtime: delivery.Runtime}
	status, err := workforceCompose.NewAbsenceMailStatus(owners.WorkforceMails{Outcomes: delivery.Runtime.EmailOutcomes})
	if err != nil {
		return nil, nil, err
	}
	enqueue := func(ctx context.Context, relatedType string, relatedID int64, address string) error {
		return outbox.EnqueueTransactionalMail(ctx, owners.DurableMail{
			TenantID: tenant.FromContext(ctx), Type: relatedType, ReferenceID: relatedID,
			Message: email.Message{
				From: email.NewEmail("moto", "no-reply@example.test"), To: email.NewEmail("Mail Empfang", address),
				Subject: "Abwesenheit", Template: "absence-request-received.html",
			},
		})
	}
	return status, enqueue, nil
}
