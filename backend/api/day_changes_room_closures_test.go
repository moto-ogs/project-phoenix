package api

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type roomClosureFilterReads struct {
	filter facilities.RoomClosureFilter
}

func (r *roomClosureFilterReads) ListRoomClosures(_ context.Context, filter facilities.RoomClosureFilter) ([]facilities.RoomClosure, error) {
	r.filter = filter
	return nil, nil
}

func TestDayChangesRoomClosuresExcludeArchivedRooms(t *testing.T) {
	t.Parallel()

	day := calendar.NewDate(2026, 11, 26)
	reads := &roomClosureFilterReads{}
	source := dayChangesRoomClosures{reads: reads}
	ctx := context.WithValue(context.Background(), sessiontoken.CtxPermissions, []string{permissions.RoomsRead})

	entries, err := source.RoomClosures(ctx, day)

	require.NoError(t, err)
	assert.Empty(t, entries)
	assert.Equal(t, facilities.RoomClosureFilter{
		From:                 day,
		Until:                day,
		ExcludeArchivedRooms: true,
	}, reads.filter)
}
