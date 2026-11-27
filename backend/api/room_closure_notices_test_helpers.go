//go:build testhooks

package api

import (
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	facilitiesModule "github.com/moto-ogs/project-phoenix/modules/facilities"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
)

// NewNoticedRoomClosuresForTest composes the closures the way the serving
// root does (#8234): a new closure tells the staff planned in the room,
// without the account of the request. The staff accounts come from School
// Membership's staff records.
func NewNoticedRoomClosuresForTest(db transactionruntime.Database, closures facilitiesModule.Closures, notifier deliveryCompose.Notifier, preferences deliveryCompose.NotificationPreferenceService, now func() time.Time) (facilitiesModule.Closures, error) {
	staff, _, err := newInvitationMembershipRepositories(db)
	if err != nil {
		return nil, err
	}
	return owners.NoticeRoomClosures(db, closures, owners.DeliveryNotifications{Notifier: notifier, Preferences: preferences}, staff, roomClosureActor, now)
}
