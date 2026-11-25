package api

import (
	facilitiesModule "github.com/moto-ogs/project-phoenix/modules/facilities"
	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// FacilitiesRooms are the retained room service with its occupancy and
// history over Student Presence, and the running sessions the yard reads.
type FacilitiesRooms struct {
	RoomService facilitiesCompose.RoomService
	OpenGroups  facilitiesCompose.OpenGroupCatalog
	// Closures are the room closures (#7653) the rooms routes keep and the
	// kiosk's session start refuses.
	Closures facilitiesModule.Closures
}

// buildFacilitiesRooms builds the retained room service and the open
// groups of the yard over Student Presence.
func buildFacilitiesRooms(presence studentpresence.Owner, rooms facilitiesModule.Catalog, closures facilitiesModule.Closures, today func() calendar.Date, timetableOwner timetable.Capability, membership schoolmembership.Capability, persons peopledirectory.Capability) FacilitiesRooms {
	return FacilitiesRooms{
		Closures: closures,
		RoomService: facilitiesCompose.NewRoomService(facilitiesCompose.RoomServiceConfig{
			Rooms:     rooms,
			Occupancy: facilitiesCompose.OccupancyProjection(RoomOccupancyPresence{presence}, roomActivityNames{timetableOwner}, membership, persons),
			History:   facilitiesCompose.HistoryProjection(RoomHistoryPresence{presence}, roomActivityNames{timetableOwner}, membership, persons),
			Today:     today,
		}),
		OpenGroups: facilitiesCompose.NewOpenGroupCatalog(FacilitiesGroupSupervisions(presence), FacilitiesRoomSessions(presence), FacilitiesGroupVisits(presence)),
	}
}
