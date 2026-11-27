//go:build testhooks

package api

import (
	"context"
	"log/slog"
	"time"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// fixtureMailOutbox drives each committed fixture intent through the actual
// leased worker without introducing a persistent test service graph.
type fixtureMailOutbox struct {
	outbox   owners.OutboxEnqueuer
	runtime  *deliveryCompose.Runtime
	mailer   email.Mailer
	logger   *slog.Logger
	renderer func() deliveryCompose.MailRenderer
}

func newFixtureMailOutbox(delivery DeliveryTestModule, mailer email.Mailer, logger *slog.Logger, identity *identityaccess.Owner) fixtureMailOutbox {
	return fixtureMailOutbox{
		outbox:  owners.OutboxEnqueuer{Outbox: delivery.EmailOutbox, Runtime: delivery.Runtime},
		runtime: delivery.Runtime, mailer: mailer, logger: logger,
		// Identity is composed after the outbox. Resolve it when the mail is sent.
		renderer: func() deliveryCompose.MailRenderer {
			return owners.TransactionalMailRenderer{Identity: *identity, Logger: logger}
		},
	}
}

func (f fixtureMailOutbox) EnqueueTransactionalMail(ctx context.Context, mail owners.DurableMail) error {
	queued, err := f.outbox.EnqueueMailIntent(ctx, mail)
	if err != nil {
		return err
	}
	tenant.RegisterAfterCommit(ctx, func() {
		sendCtx, cancel := context.WithTimeout(identityaccessFixtureContext(ctx), 15*time.Second)
		defer cancel()
		provider := &deliveryCompose.MailPushProvider{
			Registry: deliveryCompose.NewEmailTemplateRegistry(map[string]deliveryCompose.MailRenderer{
				owners.TransactionalMailKind: f.renderer(),
			}), Mailer: f.mailer, Logger: f.logger, Tenants: deliveryCompose.NewTenantTransactions(nil), Now: f.runtime.Now,
		}
		if err := deliveryCompose.DrainEmailForTest(sendCtx, f.runtime, provider, mail.TenantID, queued.ID); err != nil {
			f.logger.Error("fixture outbox worker failed", "error", err.Error())
		}
		if mail.TenantID == 0 {
			if err := deliveryCompose.DeleteSystemEmailForTest(sendCtx, f.runtime, queued.ID); err != nil {
				f.logger.Error("fixture system mail cleanup failed", "error", err.Error())
			}
		}
	})
	return nil
}

func identityaccessFixtureContext(ctx context.Context) context.Context {
	return tenant.ContextWithoutAfterCommitHooks(tenant.ContextWithoutTransaction(context.WithoutCancel(ctx)))
}

// Default fixtures expose the committed transport and own their global rows.
// Transactional-outbox tests opt out and retain entries for their assertions.
type fixtureMFAMail func() (owners.MFAMailer, *deliveryCompose.Runtime, *slog.Logger)

func (fixture fixtureMFAMail) capture() (owners.MFAMailer, *int64, *deliveryCompose.Runtime, *slog.Logger) {
	source, runtime, logger := fixture()
	var id int64
	enqueue := source.Enqueue
	source.Enqueue = func(ctx context.Context, mail owners.DurableMail) (int64, error) {
		queued, err := enqueue(ctx, mail)
		id = queued
		return queued, err
	}
	return source, &id, runtime, logger
}

func (fixture fixtureMFAMail) EnqueueCode(ctx context.Context, message identityaccess.MFACodeMail, challengeID int64, expiresAt time.Time) (func(context.Context) error, error) {
	source, id, runtime, logger := fixture.capture()
	send, err := source.EnqueueCode(ctx, message, challengeID, expiresAt)
	if err != nil {
		return nil, err
	}
	return func(sendCtx context.Context) error {
		sendErr := send(sendCtx)
		if err := deliveryCompose.DeleteSystemEmailForTest(identityaccessFixtureContext(ctx), runtime, *id); err != nil {
			logger.Error("fixture MFA outbox cleanup failed", "error", err.Error())
		}
		return sendErr
	}, nil
}

func (fixture fixtureMFAMail) NotifyTrustedDeviceAdded(ctx context.Context, message identityaccess.TrustedDeviceMail, deviceID int64) error {
	source, id, runtime, logger := fixture.capture()
	if err := source.NotifyTrustedDeviceAdded(ctx, message, deviceID); err != nil {
		return err
	}
	tenant.RegisterAfterCommit(ctx, func() {
		sendCtx := identityaccessFixtureContext(ctx)
		if err := source.Deliver(sendCtx, *id); err != nil {
			logger.Error("fixture MFA notice failed", "error", err.Error())
		}
		if err := deliveryCompose.DeleteSystemEmailForTest(sendCtx, runtime, *id); err != nil {
			logger.Error("fixture MFA notice cleanup failed", "error", err.Error())
		}
	})
	return nil
}
