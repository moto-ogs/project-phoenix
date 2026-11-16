package owners

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	deliveryContract "github.com/moto-ogs/project-phoenix/modules/delivery/contract"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type closingDayAudienceFunc func(context.Context, int64) (deliveryContract.SchoolAudienceMembers, error)

func (f closingDayAudienceFunc) SchoolAudience(ctx context.Context, tenantID int64) (deliveryContract.SchoolAudienceMembers, error) {
	return f(ctx, tenantID)
}

type closingDayPreferencesDouble struct {
	permitted      []int64
	permittedType  string
	permittedInput []int64
}

func (d *closingDayPreferencesDouble) FilterNotOptedOut(_ context.Context, _ string, accountIDs []int64) ([]int64, error) {
	return accountIDs, nil
}

func (d *closingDayPreferencesDouble) FilterPermitted(_ context.Context, notificationType string, accountIDs []int64) ([]int64, error) {
	d.permittedType = notificationType
	d.permittedInput = accountIDs
	return d.permitted, nil
}

func TestClosingDayNoticesExcludeStaffWithoutTheTypePermission(t *testing.T) {
	t.Parallel()
	preferences := &closingDayPreferencesDouble{permitted: []int64{11}}
	var sent deliveryCompose.NotificationEvent
	notices := schoolCalendarClosingDayNotices{
		audience: closingDayAudienceFunc(func(context.Context, int64) (deliveryContract.SchoolAudienceMembers, error) {
			return deliveryContract.SchoolAudienceMembers{
				StaffAccountIDs:  []int64{11, 12, 14},
				SchoolAccountIDs: []int64{12, 13},
			}, nil
		}),
		notifier:    staffPushRouterFunc(func(_ context.Context, event deliveryCompose.NotificationEvent) error { sent = event; return nil }),
		preferences: preferences,
		actor:       func(context.Context) int64 { return 0 },
		now:         func() time.Time { return time.Unix(0, 0) },
	}

	days := schoolcalendar.ClosingDayRange{StartsOn: calendar.NewDate(2030, time.June, 12), EndsOn: calendar.NewDate(2030, time.June, 12)}
	require.NoError(t, notices.NotifyClosingDayChanged(t.Context(), schoolcalendar.ClosingDayNotice{ClosingDayID: 7, Current: &days, Push: true}))

	assert.Equal(t, deliveryContract.NotificationSchoolClosingDayChanged, preferences.permittedType)
	assert.Equal(t, []int64{11, 12, 14}, preferences.permittedInput)
	assert.Equal(t, []int64{11, 12, 13}, sent.Audience.StaffAccountIDs)
	assert.NotNil(t, sent.Feed)
	assert.Equal(t, []int64{11, 12, 13}, sent.Feed.PushAccountIDs)
}
