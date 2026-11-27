package owners

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/tenant"
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

	require.NoError(t, notices.NotifySchool(t.Context(), 0, schoolcalendar.OpeningChangeNotice{OpeningChangeID: 17}, schoolcalendar.OpeningChangeNotice{OpeningChangeID: 17}))
	assert.Contains(t, output.String(), "school calendar: Träger opening change notice failed")
	assert.Contains(t, output.String(), "component=traeger_opening_change_notices")
}

func TestTraegerOpeningChangeRetractionsFollowTheTraegerTransaction(t *testing.T) {
	t.Parallel()
	finished := func(result tenant.UnitOfWorkResult) tenant.UnitOfWorkEvent {
		return tenant.UnitOfWorkEvent{Kind: tenant.UnitOfWorkTransaction, Result: result}
	}
	// run settles one retraction to a school that cannot be written, so
	// each attempt to tell it is logged.
	run := func(events ...tenant.UnitOfWorkEvent) string {
		var output bytes.Buffer
		notices := traegerOpeningChangeNotices{logger: slog.New(slog.NewTextHandler(&output, &slog.HandlerOptions{Level: slog.LevelWarn}))}
		ctx, settle := WithTraegerOpeningChangeRetractions(t.Context())
		retractions := ctx.Value(traegerOpeningChangeRetractionsKey{}).(*traegerOpeningChangeRetractions)
		retractions.add(traegerOpeningChangeRetraction{notices: notices, retraction: schoolcalendar.OpeningChangeNotice{OpeningChangeID: 17}})
		// A school notice commits while the handler runs.
		retractions.observe(finished(tenant.UnitOfWorkCommitted))
		TraegerOpeningChangeHandled(ctx)
		for _, event := range events {
			retractions.observe(event)
		}
		settle(t.Context())
		settle(t.Context())
		return output.String()
	}
	const failed, unknown = "Träger opening change retraction failed", "Träger opening change commit unknown, notice kept"

	assert.Empty(t, run(finished(tenant.UnitOfWorkCommitted), finished(tenant.UnitOfWorkRolledBack)),
		"a committed Träger transaction keeps the notices, whatever an after-commit hook's transaction does")
	rolledBack := run(finished(tenant.UnitOfWorkRolledBack), finished(tenant.UnitOfWorkCommitted))
	assert.Equal(t, 1, strings.Count(rolledBack, failed), "a Träger transaction that rolls back retracts once, and a failed retraction is logged")
	assert.Contains(t, rolledBack, "level=ERROR")
	assert.Contains(t, rolledBack, "opening_change_id=17")
	kept := run(finished(tenant.UnitOfWorkCommitUnknown))
	assert.Contains(t, kept, unknown)
	assert.NotContains(t, kept, failed, "a commit of unknown outcome retracts nothing")
	assert.Contains(t, run(), failed, "a transaction that never reported a commit retracts")
}
