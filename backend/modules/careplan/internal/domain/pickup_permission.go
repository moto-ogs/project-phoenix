package domain

import "github.com/moto-ogs/project-phoenix/modules/careplan"

// planWeekdays are the weekdays a pickup permission can name (1 = Monday …
// 5 = Friday). A weekend that follows Friday's plan counts as Friday.
var planWeekdays = []int{1, 2, 3, 4, 5}

// WithdrawnPickupWeekdays are the plan weekdays on which before allowed the
// contact to collect the child and after no longer does (#8206). A change
// that only widens the permission withdraws nothing.
func WithdrawnPickupWeekdays(before, after careplan.GuardianPickupPermissionState) []int {
	var withdrawn []int
	for _, weekday := range planWeekdays {
		if before.Allows(weekday) && !after.Allows(weekday) {
			withdrawn = append(withdrawn, weekday)
		}
	}
	return withdrawn
}

// ChangedPickupPermission is the state a change leaves: the supplied columns
// over the stored ones.
func ChangedPickupPermission(before careplan.GuardianPickupPermissionState, change careplan.GuardianPickupPermissionChange) careplan.GuardianPickupPermissionState {
	after := before
	if change.CanPickup != nil {
		after.CanPickup = *change.CanPickup
	}
	if change.SetWeekdays {
		after.Weekdays = change.Weekdays
	}
	return after
}
