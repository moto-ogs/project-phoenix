package owners

import (
	"bytes"
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
)

type traegerOpeningChangeAudienceDouble struct{}
type traegerOpeningChangeNotifierDouble struct{ deliveryCompose.Notifier }
type traegerOpeningChangePreferencesDouble struct {
	deliveryCompose.NotificationPreferenceService
}

func (traegerOpeningChangeAudienceDouble) SchoolAudience(context.Context, int64) (deliveryContract.SchoolAudienceMembers, error) {
	return deliveryContract.SchoolAudienceMembers{}, nil
}

func TestTraegerOpeningChangeNoticesUseTheInjectedLogger(t *testing.T) {
	t.Parallel()
	var output bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&output, &slog.HandlerOptions{Level: slog.LevelWarn}))
	notices := NewTraegerOpeningChangeNotices(DeliveryNotifications{
		SchoolAudience: traegerOpeningChangeAudienceDouble{},
		Notifier:       traegerOpeningChangeNotifierDouble{},
		Preferences:    traegerOpeningChangePreferencesDouble{},
	}, func(context.Context) int64 { return 0 }, logger)
	require.NotNil(t, notices)

	require.NoError(t, notices.NotifySchool(t.Context(), 0, schoolcalendar.OpeningChangeNotice{OpeningChangeID: 17}))
	assert.Contains(t, output.String(), "school calendar: Träger opening change notice failed")
	assert.Contains(t, output.String(), "component=traeger_opening_change_notices")
}
