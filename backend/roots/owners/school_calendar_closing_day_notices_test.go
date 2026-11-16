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
	var sent []deliveryCompose.NotificationEvent
	notices := schoolCalendarClosingDayNotices{
		audience: closingDayAudienceFunc(func(context.Context, int64) (deliveryContract.SchoolAudienceMembers, error) {
			return deliveryContract.SchoolAudienceMembers{
				StaffAccountIDs:  []int64{11, 12, 14},
				SchoolAccountIDs: []int64{12, 13},
			}, nil
		}),
		notifier: staffPushRouterFunc(func(_ context.Context, event deliveryCompose.NotificationEvent) error {
			sent = append(sent, event)
			return nil
		}),
		preferences: preferences,
		actor:       func(context.Context) int64 { return 0 },
		now:         func() time.Time { return time.Unix(0, 0) },
	}

	days := schoolcalendar.ClosingDayRange{StartsOn: calendar.NewDate(2030, time.June, 12), EndsOn: calendar.NewDate(2030, time.June, 12)}
	require.NoError(t, notices.NotifyClosingDayChanged(t.Context(), schoolcalendar.ClosingDayNotice{ClosingDayID: 7, Current: &days, Push: true}))

	assert.Equal(t, deliveryContract.NotificationSchoolClosingDayChanged, preferences.permittedType)
	assert.Equal(t, []int64{11, 12, 14}, preferences.permittedInput)
	require.Len(t, sent, 2)
	assert.Equal(t, []int64{11}, sent[0].Audience.StaffAccountIDs)
	assert.Empty(t, sent[0].Portal)
	require.NotNil(t, sent[0].Feed)
	assert.Equal(t, []int64{11}, sent[0].Feed.PushAccountIDs)
	assert.Equal(t, []int64{12, 13}, sent[1].Audience.StaffAccountIDs)
	assert.Equal(t, "school", sent[1].Portal)
	assert.Empty(t, sent[1].DeepLink)
	assert.Equal(t, closingDaySchoolLink, sent[1].SchoolDeepLink)
	require.NotNil(t, sent[1].Feed)
	assert.Equal(t, []int64{12, 13}, sent[1].Feed.PushAccountIDs)
}

func TestClosingDayParentLinkUsesTheParentsCalendar(t *testing.T) {
	t.Parallel()
	days := schoolcalendar.ClosingDayRange{StartsOn: calendar.NewDate(2030, time.June, 12), EndsOn: calendar.NewDate(2030, time.June, 12)}

	assert.Equal(t, "/parents/calendar?date=2030-06-12", closingDayParentLinkFor(schoolcalendar.ClosingDayNotice{Current: &days}))
}
