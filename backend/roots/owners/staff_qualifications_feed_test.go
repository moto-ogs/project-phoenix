package owners

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// feedNotifierDouble records the events of Delivery's router.
type feedNotifierDouble struct {
	deliveryCompose.Notifier
	sent []deliveryCompose.NotificationEvent
	err  error
}

func (d *feedNotifierDouble) Notify(_ context.Context, event deliveryCompose.NotificationEvent) error {
	d.sent = append(d.sent, event)
	return d.err
}

// feedPreferencesDouble lets everyone but declined agree to a type.
type feedPreferencesDouble struct {
	deliveryCompose.NotificationPreferenceService
	declined int64
}

func (d feedPreferencesDouble) keep(ids []int64) []int64 {
	var kept []int64
	for _, id := range ids {
		if id != d.declined {
			kept = append(kept, id)
		}
	}
	return kept
}

func (d feedPreferencesDouble) FilterNotOptedOut(_ context.Context, _ string, ids []int64) ([]int64, error) {
	return d.keep(ids), nil
}

func (d feedPreferencesDouble) FilterOptedIn(_ context.Context, _ string, ids []int64) ([]int64, error) {
	return d.keep(ids), nil
}

// A Nachweis reminder reaches the feed of every recipient; the push drops
// whoever switched it off, and outside the window both wait for the next
// run (#7137).
func TestQualificationReminderWritesTheFeedForEveryRecipient(t *testing.T) {
	t.Parallel()
	for _, own := range []bool{false, true} {
		notifier := &feedNotifierDouble{}
		notify := qualificationNotifier(DeliveryNotifications{Notifier: notifier, Preferences: feedPreferencesDouble{declined: 2}}, slog.Default())
		sent, err := notify(t.Context(), workforce.QualificationNotice{
			TenantID: 4, StaffID: 9, QualificationID: 31, Own: own, Title: "Nachweis läuft ab", DeepLink: "/staff/9", IdempotencyKey: "k",
			RecipientAccountIDs: []int64{1, 2},
		})
		require.NoError(t, err)
		assert.True(t, sent)
		require.Len(t, notifier.sent, 1)
		event := notifier.sent[0]
		assert.Equal(t, []int64{1, 2}, event.Audience.StaffAccountIDs)
		assert.Equal(t, int64(31), event.RelatedID, "entries bundle per Nachweis, not per person")
		require.NotNil(t, event.Feed)
		assert.Equal(t, []int64{1}, event.Feed.PushAccountIDs)
		assert.True(t, event.Feed.HoldOutsideWindow)
	}

	held := &feedNotifierDouble{err: deliveryCompose.ErrOutsideNotificationWindow}
	notify := qualificationNotifier(DeliveryNotifications{Notifier: held, Preferences: feedPreferencesDouble{}}, slog.Default())
	sent, err := notify(t.Context(), workforce.QualificationNotice{TenantID: 4, QualificationID: 32, Title: "T", RecipientAccountIDs: []int64{1}})
	require.NoError(t, err)
	assert.False(t, sent, "the run repeats the held notice")
	assert.Equal(t, deliveryContract.NotificationStaffQualificationExpiry, held.sent[0].Type)
}
