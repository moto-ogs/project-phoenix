package owners

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	email "github.com/moto-ogs/project-phoenix/modules/delivery/mail"
)

const TransactionalMailKind = "transactional_mail"

// securityMailTypes are the mails someone waits for to get in: they go before
// other mail, and the suppression list never holds them back (#5932).
var securityMailTypes = map[string]bool{
	"mfa_email_code":               true,
	"operator_mfa_email_code":      true,
	"password_reset":               true,
	"invitation":                   true,
	"operator_invitation":          true,
	"traeger_invitation":           true,
	"operator_email_change_verify": true,
}

// DurableMail is a rendered feature snapshot, persisted with its triggering
// write. TenantID is absent for global identity flows, never a made-up school.
type DurableMail struct {
	IdempotencyKey string
	TenantID       int64
	Message        email.Message
	Type           string
	ReferenceID    int64
	BaseRetry      int
	ExpiresAt      time.Time
	MaxAttempts    int             `json:"delivery_max_attempts,omitempty"`
	Backoff        []time.Duration `json:"delivery_backoff,omitempty"`
}

type DurableMailOutbox interface {
	EnqueueTransactionalMail(context.Context, DurableMail) error
}

type transactionalMailPayload struct {
	MaxAttempts int             `json:"delivery_max_attempts,omitempty"`
	Backoff     []time.Duration `json:"delivery_backoff,omitempty"`
	Message     email.Message
	Type        string
	ReferenceID int64
	BaseRetry   int
	ExpiresAt   time.Time
}

func (o OutboxEnqueuer) EnqueueTransactionalMail(ctx context.Context, mail DurableMail) error {
	_, err := o.EnqueueMailIntent(ctx, mail)
	return err
}

func (o OutboxEnqueuer) EnqueueMailIntent(ctx context.Context, mail DurableMail) (deliveryContract.Enqueued, error) {
	if o.Runtime == nil || o.Runtime.Module == nil {
		return deliveryContract.Enqueued{}, errors.New("transactional mail: delivery is not configured")
	}
	if mail.MaxAttempts == 0 {
		mail.MaxAttempts = email.InteractiveMaxAttempts
	}
	if mail.Backoff == nil {
		mail.Backoff = email.InteractiveRetryBackoff()
	}
	payload, err := json.Marshal(transactionalMailPayload{
		MaxAttempts: mail.MaxAttempts, Backoff: mail.Backoff,
		Message: mail.Message, Type: mail.Type, ReferenceID: mail.ReferenceID,
		BaseRetry: mail.BaseRetry, ExpiresAt: mail.ExpiresAt,
	})
	if err != nil {
		return deliveryContract.Enqueued{}, fmt.Errorf("encode transactional mail: %w", err)
	}
	intent := deliveryContract.EmailIntent{
		TenantID: mail.TenantID, Template: TransactionalMailKind, IdempotencyKey: mail.IdempotencyKey,
		Recipient: deliveryContract.EmailRecipient{Name: mail.Message.To.Name, Address: mail.Message.To.Address},
		Payload:   payload, Security: securityMailTypes[mail.Type],
	}
	if mail.ReferenceID > 0 {
		intent.Related = deliveryContract.RelatedEntity{Type: mail.Type, ID: mail.ReferenceID}
	}
	if mail.TenantID > 0 {
		return o.Runtime.Module.EnqueueEmail(ctx, intent)
	}
	return o.Runtime.Module.EnqueueSystemEmail(ctx, intent)
}

func enqueueDurableMail(ctx context.Context, outbox DurableMailOutbox, mail DurableMail) error {
	if outbox == nil {
		return errors.New("transactional mail: outbox is required")
	}
	return outbox.EnqueueTransactionalMail(ctx, mail)
}

func decodeTransactionalMail(intent *deliveryCompose.MailIntent) (transactionalMailPayload, error) {
	encoded := intent.PayloadJSON
	if len(encoded) == 0 {
		var err error
		encoded, err = json.Marshal(intent.Payload)
		if err != nil {
			return transactionalMailPayload{}, err
		}
	}
	var payload transactionalMailPayload
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	err := decoder.Decode(&payload)
	if err == nil {
		payload.Message.Content = mailTemplateNumbers(payload.Message.Content)
		if payload.Type == "demo_lead" {
			if content, ok := payload.Message.Content.(map[string]any); ok {
				if id, ok := content["AccessID"].(int); ok {
					content["AccessID"] = int64(id)
				}
			}
		}
	}
	return payload, err
}

// Feature snapshots contain integer template values. Restore their Go shape
// rather than exposing JSON floating-point formatting to existing templates.
func mailTemplateNumbers(value any) any {
	switch value := value.(type) {
	case json.Number:
		if integer, err := value.Int64(); err == nil {
			return int(integer)
		}
	case map[string]any:
		for key, item := range value {
			value[key] = mailTemplateNumbers(item)
		}
	case []any:
		for index, item := range value {
			value[index] = mailTemplateNumbers(item)
		}
	}
	return value
}

// TransactionalMailRenderer preserves the feature's snapshot and reports real
// transport attempts through the existing Identity & Access delivery records.
type TransactionalMailRenderer struct {
	Identity identityaccess.Owner
	Logger   *slog.Logger
}

func (r TransactionalMailRenderer) Render(_ context.Context, intent *deliveryCompose.MailIntent) (*email.Message, error) {
	payload, err := decodeTransactionalMail(intent)
	if err != nil {
		return nil, err
	}
	if !payload.ExpiresAt.IsZero() && !payload.ExpiresAt.After(time.Now()) {
		return nil, fmt.Errorf("%w: link expired", deliveryCompose.ErrRenderCancelled)
	}
	return &payload.Message, nil
}

// transactionalSendFinal reports whether a send ends the mail: it went out,
// the server refused it for good, or it used up the last attempt. A throttled
// send is postponed without using up an attempt (#6737), so it never ends the
// mail, even at its last attempt.
func transactionalSendFinal(attempt, maxAttempts int, sendErr error) bool {
	if sendErr == nil || errors.Is(sendErr, email.ErrPermanentRejection) {
		return true
	}
	return attempt >= maxAttempts && !errors.Is(sendErr, email.ErrSendPostponed)
}

type transactionalMailAttempt struct {
	referenceID int64
	recipient   string
	retryCount  int
	sentAt      time.Time
	err         error
	final       bool
}

func (a transactionalMailAttempt) tokenDelivery() identityaccess.TokenDelivery {
	delivery := identityaccess.TokenDelivery{RetryCount: a.retryCount}
	if a.err == nil {
		sentAt := a.sentAt
		delivery.SentAt = &sentAt
	} else {
		message := strings.TrimSpace(a.err.Error())
		delivery.Error = &message
	}
	return delivery
}

func (r TransactionalMailRenderer) RecordDelivery(ctx context.Context, intent *deliveryCompose.MailIntent, sendErr error) error {
	payload, err := decodeTransactionalMail(intent)
	if err != nil {
		return err
	}
	attemptNumber := intent.Attempts + 1
	attempt := transactionalMailAttempt{
		referenceID: payload.ReferenceID,
		recipient:   payload.Message.To.Address,
		retryCount:  payload.BaseRetry + attemptNumber,
		sentAt:      time.Now(),
		err:         sendErr,
		final:       transactionalSendFinal(attemptNumber, payload.MaxAttempts, sendErr),
	}
	switch payload.Type {
	case "password_reset":
		passwordResetDelivery{records: r.Identity, logger: r.Logger}.recordDelivery(ctx, attempt)
	case "invitation":
		invitationDelivery{invitations: r.Identity, logger: r.Logger}.recordDelivery(ctx, attempt)
	case "operator_invitation":
		operatorLinkDelivery{tokens: r.Identity, logger: r.Logger}.recordInvitationDelivery(ctx, attempt)
	case "operator_email_change_verify":
		operatorLinkDelivery{tokens: r.Identity, logger: r.Logger}.recordEmailChangeDelivery(ctx, attempt)
	}
	return nil
}
