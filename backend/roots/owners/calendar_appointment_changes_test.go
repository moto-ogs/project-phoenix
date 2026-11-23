package owners

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/moto-ogs/project-phoenix/realtime"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The calendar announces a change inside its write; Delivery's shared site
// (ADR 0310) sends calendar_appointments_changed after the commit, without
// content, to the staff sessions of that school only (#7693).
func TestCalendarAppointmentChangesBroadcastAfterCommitWithoutContent(t *testing.T) {
	t.Parallel()
	broadcaster := testpkg.NewRecordingBroadcaster()
	changes := NewCalendarAppointmentChanges(broadcaster, nil)
	ctx, commit := testpkg.WithAfterCommitHooks(testpkg.TenantContext(42))

	changes.Announce(ctx)
	assert.Empty(t, broadcaster.Events(), "the signal must not precede the commit")
	commit()

	events := broadcaster.EventsOfType(realtime.EventCalendarAppointmentsChanged)
	require.Len(t, events, 1)
	calls := broadcaster.CallsByMethod("tenant")
	require.Len(t, calls, 1)
	assert.Equal(t, int64(42), calls[0].TenantID, "only the school that wrote")
	data, err := json.Marshal(events[0].Data)
	require.NoError(t, err)
	assert.JSONEq(t, "{}", string(data), "the signal carries no content")
	assert.Len(t, broadcaster.Calls(), 1, "only the tenant-wide staff broadcast")
}

func TestCalendarAppointmentChangesNeedBroadcasterAndSchool(t *testing.T) {
	t.Parallel()
	assert.Nil(t, NewCalendarAppointmentChanges(nil, nil))
	broadcaster := testpkg.NewRecordingBroadcaster()
	ctx, commit := testpkg.WithAfterCommitHooks(context.Background())
	NewCalendarAppointmentChanges(broadcaster, nil).Announce(ctx)
	commit()
	assert.Empty(t, broadcaster.Events())
}
