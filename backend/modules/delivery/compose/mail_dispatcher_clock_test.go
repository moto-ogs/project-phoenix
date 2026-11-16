package compose

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/delivery/mail"
	"github.com/stretchr/testify/require"
)

type acceptingMailer struct{}

func (acceptingMailer) Send(mail.Message) error { return nil }

// The dispatcher stamps a delivery result with the root's clock, which the
// invitation and reset records keep as their send time.
func TestMailDispatcherStampsResultsWithTheRootClock(t *testing.T) {
	t.Parallel()
	pinned := time.Date(2021, time.March, 10, 9, 30, 0, 0, time.UTC)
	var sentAt time.Time
	dispatcher := NewMailDispatcher(acceptingMailer{}, slog.Default(), func() time.Time { return pinned })

	err := dispatcher.Deliver(context.Background(), mail.DeliveryRequest{
		Message:     mail.Message{To: mail.Email{Address: "recipient@example.invalid"}, Template: "notice"},
		MaxAttempts: 1,
		Callback:    func(_ context.Context, result mail.DeliveryResult) { sentAt = result.SentAt },
	})

	require.NoError(t, err)
	require.Equal(t, pinned, sentAt)
}
