package owners

import (
	"context"
	"errors"
	"testing"

	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

type absenceMailOutbox struct{ last DurableMail }

func (o *absenceMailOutbox) EnqueueTransactionalMail(_ context.Context, mail DurableMail) error {
	o.last = mail
	return nil
}

func TestAbsenceEmailDeliveryPreservesMetadataAndContent(t *testing.T) {
	t.Parallel()
	resolver := &testpkg.ReplyToResolverStub{Name: "School", Address: "school@example.test"}
	outbox := &absenceMailOutbox{}
	dispatcher := AbsenceEmailDispatcher{Identity: resolver, Durable: outbox}
	dispatcher.From.Name, dispatcher.From.Address = "moto", "no-reply@example.test"
	message := workforceCompose.AbsenceEmailMessage{
		Type: "absence_request_received", ReferenceID: 42, TenantID: 7,
		Template: "absence-request-received.html", Subject: "Request",
	}
	message.To.Name, message.To.Address = "Recipient", "recipient@example.test"
	message.Content.FirstName, message.Content.LastName = "First", "Last"
	message.Content.RequesterName, message.Content.AbsenceTypeLabel = "Requester", "Leave"
	message.Content.DateRange, message.Content.Note = "01.01.2026", "Note"
	message.Content.PreviousQuestion = "Question"
	message.Content.LinkURL, message.Content.LogoURL = "https://school.example.test/staff", "https://example.test/logo.png"
	require.NoError(t, dispatcher.Enqueue(context.Background(), message))
	require.Equal(t, message.TenantID, resolver.TenantID)
	require.Equal(t, message.TenantID, outbox.last.TenantID)
	require.Equal(t, message.Type, outbox.last.Type)
	require.Equal(t, message.ReferenceID, outbox.last.ReferenceID)
	require.Equal(t, dispatcher.From, outbox.last.Message.From)
	require.Equal(t, message.To.Name, outbox.last.Message.To.Name)
	require.Equal(t, message.To.Address, outbox.last.Message.To.Address)
	require.Equal(t, "School", outbox.last.Message.ReplyTo.Name)
	require.Equal(t, "school@example.test", outbox.last.Message.ReplyTo.Address)
	require.Equal(t, message.Template, outbox.last.Message.Template)
	require.Equal(t, message.Subject, outbox.last.Message.Subject)
	require.Equal(t, map[string]any{
		"FirstName": "First", "LastName": "Last", "RequesterName": "Requester", "AbsenceTypeLabel": "Leave",
		"DateRange": "01.01.2026", "Note": "Note", "PreviousQuestion": "Question",
		"LinkURL": message.Content.LinkURL, "LogoURL": message.Content.LogoURL,
	}, outbox.last.Message.Content)
	resolver.Err = errors.New("reply address unavailable")
	message.Template = "absence-request-approved.html"
	message.Content.DecisionNote = "Approved"
	require.NoError(t, dispatcher.Enqueue(context.Background(), message))
	require.Empty(t, outbox.last.Message.ReplyTo.Address)
	content := outbox.last.Message.Content.(map[string]any)
	require.Equal(t, "Approved", content["DecisionNote"])
	require.NotContains(t, content, "PreviousQuestion")
	require.NotContains(t, content, "RequesterName")
	require.NotContains(t, content, "Note")
	resolver.Err = nil
	resolver.TenantID = 0
	message.TenantID = 0
	require.NoError(t, dispatcher.Enqueue(context.Background(), message))
	require.Zero(t, resolver.TenantID, "tenantless sends must not resolve a reply address")
	require.Empty(t, outbox.last.Message.ReplyTo.Address)
}
