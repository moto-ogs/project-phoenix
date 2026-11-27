package supervisiondashboard

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/sharedkernel/collation"
)

// SortSessionsByRoom orders sessions by German room name. Sessions in equally
// named rooms keep their read order.
func SortSessionsByRoom(sessions []Session) {
	slices.SortStableFunc(sessions, func(a, b Session) int {
		return collation.CompareGerman(a.RoomName, b.RoomName)
	})
}
